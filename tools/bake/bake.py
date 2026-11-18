# Step 2 of the lighting bake: lights the school with Blender Cycles (path tracing: light bouncing off every surface).
#   pip install bpy                       (Blender as a Python module; the bake runs on the CPU)
#   python3 tools/bake/bake.py tools/bake/out/scene tools/bake/out 2048 48
#   then copy out/lm-a.webp, lm-b.webp, lm-uv.bin and lm.json into client/assets/lightmap/
# About 45 minutes on 2 CPU cores at 2048 x 2048 and 48 samples. Re-bake whenever world.js changes the school's
# geometry: the game checks every mesh against lm.json and falls back to real-time lighting for any that changed.
# Layer "a": what lights the school with the power off (moonlight through the windows, the night sky over the
#            courtyard, exit signs, red emergency lamps).
# Layer "b": the ceiling fixtures once the power is back (every working, non-flickering lamp).
# Writes lm-a.webp / lm-b.webp (RGBM, gamma, lossless), lm-uv.bin (lightmap coordinates per triangle corner) and lm.json.
import bpy, bmesh, json, sys, os, math, time, ctypes
import numpy as np
from mathutils import Vector, Matrix

prefix, outdir = sys.argv[1], sys.argv[2]
SIZE, SAMPLES = int(sys.argv[3]), int(sys.argv[4])
LAYERS = sys.argv[5] if len(sys.argv) > 5 else 'ab'
TILE = 8.0          # big flat areas are cut into islands of at most 8 x 8 m (packs far tighter than whole corridors)
RANGE = 8.0         # RGBM range, in gamma space (linear range = RANGE^2 = 64)
os.makedirs(outdir, exist_ok=True)
t0 = time.time()
log = lambda *a: print(f'[{time.time() - t0:7.1f}s]', *a, flush=True)

meta = json.load(open(prefix + '.json'))
raw = np.fromfile(prefix + '.bin', dtype=np.float32).reshape(-1, 9)
B = lambda x, y, z: (x, -z, y)                       # three.js (y up) -> Blender (z up)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ material: surface colour from the game, bake target image
img = bpy.data.images.new('lm', SIZE, SIZE, alpha=False, float_buffer=True)
mat = bpy.data.materials.new('school'); mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial')
bsdf = nt.nodes.new('ShaderNodeBsdfDiffuse')
attr = nt.nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'albedo'
nt.links.new(attr.outputs['Color'], bsdf.inputs['Color'])
nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'lm'
nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
nt.nodes.active = tex

# ------------------------------------------------------------------ geometry
objs = []
off = 0
for m in meta['meshes']:
    n = m['verts']
    d = raw[off:off + n]; off += n
    pos = np.stack([d[:, 0], -d[:, 2], d[:, 1]], 1)
    nor = np.stack([d[:, 3], -d[:, 5], d[:, 4]], 1)
    col = d[:, 6:9]
    tris = n // 3
    # weld corners that share a position (and the same 8 m tile and facing), so flat areas form islands
    cen = pos.reshape(tris, 3, 3).mean(1)
    fn = nor.reshape(tris, 3, 3).mean(1)
    tile = np.floor(cen[:, :2] / TILE).astype(np.int64)
    facing = np.argmax(np.abs(fn), 1) * 2 + (fn[np.arange(tris), np.argmax(np.abs(fn), 1)] > 0)
    key = np.concatenate([np.round(pos * 500).astype(np.int64), np.repeat(tile, 3, 0), np.repeat(facing, 3)[:, None]], 1)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    verts = np.zeros((len(uniq), 3), np.float32)
    verts[inv] = pos
    faces = inv.reshape(tris, 3).copy()
    bad = (faces[:, 0] == faces[:, 1]) | (faces[:, 1] == faces[:, 2]) | (faces[:, 0] == faces[:, 2])
    if bad.any():  # degenerate triangles keep their own corners so no face is dropped (the face order is the link back)
        extra = []
        nv = len(verts)
        for t in np.nonzero(bad)[0]:
            faces[t] = [nv, nv + 1, nv + 2]; nv += 3
            extra.append(pos[t * 3:t * 3 + 3])
        verts = np.concatenate([verts] + extra, 0)
    me = bpy.data.meshes.new(f'm{m["i"]}')
    me.from_pydata(verts.tolist(), [], faces.tolist())
    me.update()
    assert len(me.polygons) == tris, ('face count changed', m['i'])
    ca = me.color_attributes.new('albedo', 'FLOAT_COLOR', 'CORNER')
    rgba = np.concatenate([col, np.ones((n, 1), np.float32)], 1)
    ca.data.foreach_set('color', rgba.reshape(-1))
    me.normals_split_custom_set([tuple(v) for v in nor])
    me.uv_layers.new(name='lm')
    me.materials.append(mat)
    ob = bpy.data.objects.new(f'o{m["i"]}', me)
    scene.collection.objects.link(ob)
    if m['decal']:  # writing, blood, webs: take light, block none
        for k in ('visible_shadow', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter'):
            setattr(ob, k, False)
    objs.append(ob)
log('geometry', len(objs), 'objects', off, 'corners')

# light-tight shell (see export.mjs): blocks inside the walls, a lid over the roof, a floor under everything
def shell():
    vs, fs = [], []
    def boxv(x0, y0, z0, x1, y1, z1):
        b = len(vs)
        for (x, y, z) in [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]: vs.append(B(x, y, z))
        fs.extend([(b, b + 1, b + 2, b + 3), (b + 4, b + 7, b + 6, b + 5), (b, b + 4, b + 5, b + 1), (b + 1, b + 5, b + 6, b + 2), (b + 2, b + 6, b + 7, b + 3), (b + 3, b + 7, b + 4, b)])
    for o in meta.get('occluders', []): boxv(*o)
    for (x, z) in meta.get('lids', []):
        boxv(x, meta['ceil'] + 0.62, z, x + 1, meta['ceil'] + 0.7, z + 1)
        boxv(x, meta['floor'] - 0.7, z, x + 1, meta['floor'] - 0.62, z + 1)
    me = bpy.data.meshes.new('shell'); me.from_pydata(vs, [], fs); me.update()
    m2 = bpy.data.materials.new('shell'); m2.use_nodes = True
    m2.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.02, 0.02, 1)
    me.materials.append(m2)
    ob = bpy.data.objects.new('shell', me); scene.collection.objects.link(ob)
    log('shell', len(fs), 'faces')
shell()

# ------------------------------------------------------------------ lightmap coordinates
bpy.ops.object.select_all(action='DESELECT')
for ob in objs: ob.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=float(os.environ.get("MARGIN", "0.0002")), area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
# (smart_project already packs every island of every object into one square; pack_islands would undo it here)
bpy.ops.object.mode_set(mode='OBJECT')
log('unwrapped')
def uvstats():
    tot3 = totuv = 0; lo = np.array([9.0, 9.0]); hi = np.array([-9.0, -9.0]); zero = 0
    for ob in objs:
        me = ob.data; n = len(me.loops)
        uv = np.empty(n * 2, np.float32); me.uv_layers['lm'].data.foreach_get('uv', uv); uv = uv.reshape(-1, 3, 2)
        a = 0.5 * np.abs((uv[:, 1, 0] - uv[:, 0, 0]) * (uv[:, 2, 1] - uv[:, 0, 1]) - (uv[:, 2, 0] - uv[:, 0, 0]) * (uv[:, 1, 1] - uv[:, 0, 1]))
        totuv += a.sum(); zero += int((a < 1e-12).sum()); lo = np.minimum(lo, uv.reshape(-1, 2).min(0)); hi = np.maximum(hi, uv.reshape(-1, 2).max(0))
        tot3 += sum(p.area for p in me.polygons)
    log('uv area used', round(float(totuv), 4), '3D area m2', round(tot3), 'zero-area uv tris', zero, 'bounds', lo, hi, 'texels/m', round(math.sqrt(totuv * SIZE * SIZE / max(tot3, 1)), 1))
uvstats()
if os.environ.get('UV_ONLY'): sys.exit(0)

# ------------------------------------------------------------------ lights
def area(name, p, d, w, h, color, power):
    """rectangle light at p (three.js coords) shining along d (three.js), w across, h up (or along, for ceiling lamps)"""
    L = bpy.data.lights.new(name, 'AREA'); L.shape = 'RECTANGLE'; L.size = w; L.size_y = h
    L.color = color; L.energy = power
    ob = bpy.data.objects.new(name, L); scene.collection.objects.link(ob)
    ob.location = B(*p)
    z = -Vector(B(*d)).normalized()                  # an area light shines down its local -Z
    up = Vector((0, 0, 1)) if abs(z.z) < 0.9 else Vector((1, 0, 0))
    x = up.cross(z).normalized(); y = z.cross(x)
    ob.matrix_world = Matrix.Translation(ob.location) @ Matrix((x, y, z)).transposed().to_4x4()
    return ob

lights = {'a': [], 'b': []}
for i, f in enumerate(meta['fixtures']):
    if f['boiler'] or f['dead']: continue
    p = (f['x'], f['y'] - 0.04, f['z'])
    w, h = (1.2, 0.26) if f['alongX'] else (0.26, 1.2)
    # ceiling lamps: X across the room is three.js X, the "up" vector trick makes Y the other axis
    L = bpy.data.lights.new(f'fx{i}', 'AREA'); L.shape = 'RECTANGLE'; L.size = w; L.size_y = h
    ob = bpy.data.objects.new(f'fx{i}', L); scene.collection.objects.link(ob); ob.location = B(*p)
    if f['emergency']:
        L.color = (1.0, 0.07, 0.04); L.energy = 34
        lights['a'].append(ob)
        L2 = L.copy(); L2.color = (0.85, 1.0, 0.88); L2.energy = 120
        ob2 = bpy.data.objects.new(f'fxw{i}', L2); scene.collection.objects.link(ob2); ob2.location = ob.location
        lights['b'].append(ob2)
    elif not f['faulty']:
        L.color = (0.85, 1.0, 0.88); L.energy = 120
        lights['b'].append(ob)
    else:
        bpy.data.objects.remove(ob)
for e in meta['emitters']:
    if e['kind'] == 'window':
        p = [e['p'][0] + e['n'][0] * 0.04, e['p'][1], e['p'][2] + e['n'][2] * 0.04]
        lights['a'].append(area('win', p, e['n'], e['w'], e['h'], (0.5, 0.62, 0.95), 75))
    elif e['kind'] == 'exit':
        p = [e['p'][0] + e['n'][0] * 0.03, e['p'][1], e['p'][2] + e['n'][2] * 0.03]
        lights['a'].append(area('exit', p, e['n'], e['w'], e['h'], (0.15, 1.0, 0.3), 4.5))
log('lights', {k: len(v) for k, v in lights.items()})

world = bpy.data.worlds.new('night'); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']

# ------------------------------------------------------------------ Cycles
scene.render.engine = 'CYCLES'
cy = scene.cycles
cy.device = 'CPU'; cy.samples = SAMPLES
cy.max_bounces = 4; cy.diffuse_bounces = 3; cy.glossy_bounces = 0; cy.transmission_bounces = 0; cy.transparent_max_bounces = 0
cy.caustics_reflective = False; cy.caustics_refractive = False
cy.sample_clamp_indirect = 8.0
scene.render.threads_mode = 'AUTO'
bk = scene.render.bake
bk.margin = 6; bk.margin_type = 'EXTEND'
bk.use_pass_direct = True; bk.use_pass_indirect = True; bk.use_pass_color = False

# ------------------------------------------------------------------ Open Image Denoise (ships inside Blender): its lightmap filter
FILTER = os.environ.get('OIDN_FILTER', 'RT').encode()
def oidn_lightmap(rgb):
    libdir = None
    for base in [os.path.dirname(bpy.__file__)] + [p for p in sys.path if p]:
        for cand in (os.path.join(base, 'lib'), os.path.join(base, 'bpy', 'lib')):
            if os.path.exists(os.path.join(cand, 'libOpenImageDenoise.so.2')): libdir = cand
    if not libdir:
        log('OIDN not found: no denoise'); return rgb
    lib = ctypes.CDLL(os.path.join(libdir, 'libOpenImageDenoise.so.2'), mode=ctypes.RTLD_GLOBAL)
    vp, cp, sz = ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t
    lib.oidnNewDevice.restype = vp; lib.oidnNewDevice.argtypes = [ctypes.c_int]
    lib.oidnCommitDevice.argtypes = [vp]
    lib.oidnNewFilter.restype = vp; lib.oidnNewFilter.argtypes = [vp, cp]
    lib.oidnSetSharedFilterImage.argtypes = [vp, cp, vp, ctypes.c_int, sz, sz, sz, sz, sz]
    lib.oidnCommitFilter.argtypes = [vp]; lib.oidnExecuteFilter.argtypes = [vp]
    lib.oidnGetDeviceError.argtypes = [vp, ctypes.POINTER(cp)]; lib.oidnGetDeviceError.restype = ctypes.c_int
    dev = lib.oidnNewDevice(1)  # CPU
    lib.oidnCommitDevice(dev)
    src = np.ascontiguousarray(rgb, dtype=np.float32); dst = np.zeros_like(src)
    h, w = src.shape[:2]
    flt = lib.oidnNewFilter(dev, FILTER)
    lib.oidnSetSharedFilterImage(flt, b'color', src.ctypes.data, 3, w, h, 0, 12, w * 12)
    if FILTER == b'RT':
        lib.oidnSetFilterBool.argtypes = [vp, cp, ctypes.c_bool]; lib.oidnSetFilterBool(flt, b'hdr', True)
    lib.oidnSetSharedFilterImage(flt, b'output', dst.ctypes.data, 3, w, h, 0, 12, w * 12)
    lib.oidnCommitFilter(flt); lib.oidnExecuteFilter(flt)
    msg = cp(); err = lib.oidnGetDeviceError(dev, ctypes.byref(msg))
    if err: log('OIDN error', err, msg.value); return rgb
    return dst

def bake(layer):
    for k, obs in lights.items():
        for ob in obs: ob.hide_render = k != layer
    if layer == 'a':  # a faint navy night sky over the open courtyard
        bg.inputs['Color'].default_value = (0.05, 0.08, 0.16, 1); bg.inputs['Strength'].default_value = 0.35
    else:
        bg.inputs['Strength'].default_value = 0.0
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs: ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    log('bake', layer, 'start')
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, use_clear=True, margin=6, margin_type='EXTEND')
    px = np.empty(SIZE * SIZE * 4, np.float32); img.pixels.foreach_get(px)
    rgb = px.reshape(SIZE, SIZE, 4)[:, :, :3].copy()
    log('bake', layer, 'done; max', float(rgb.max()), 'mean', float(rgb.mean()))
    stats = []
    for m, ob in zip(meta['meshes'], objs):
        uv = np.empty(len(ob.data.loops) * 2, np.float32); ob.data.uv_layers['lm'].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        px_ = np.clip((uv * SIZE).astype(int), 0, SIZE - 1)
        stats.append({'i': m['i'], 'type': m['type'], 'tris': m['tris'], 'mean': float(rgb[px_[:, 1], px_[:, 0]].mean())})
    json.dump(stats, open(os.path.join(outdir, f'stats-{layer}.json'), 'w'))
    np.save(os.path.join(outdir, f'raw-{layer}.npy'), rgb)
    rgb = oidn_lightmap(rgb)
    log('denoised', layer)
    return rgb

def encode(rgb, path):
    from PIL import Image
    g = np.sqrt(np.clip(rgb, 0, RANGE * RANGE))                   # gamma 2 (more precision in the dark)
    m = np.clip(g.max(2, keepdims=True) / RANGE, 1 / 255, 1)
    m = np.ceil(m * 255) / 255
    c = np.clip(g / (m * RANGE), 0, 1)
    rgba = np.concatenate([c, m], 2)
    rgba = np.flipud(rgba)                                        # Blender stores the bottom row first
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(path, lossless=True, quality=100, method=4, exact=True)

for layer in LAYERS:
    encode(bake(layer), os.path.join(outdir, f'lm-{layer}.webp'))  # lossless WebP: about a quarter smaller than PNG

# ------------------------------------------------------------------ lightmap coordinates back to the game, per triangle corner
uv_all, index = [], []
o = 0
for m, ob in zip(meta['meshes'], objs):
    uv = np.empty(len(ob.data.loops) * 2, np.float32); ob.data.uv_layers['lm'].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2); uv[:, 1] = 1 - uv[:, 1]               # image rows top-down in the game
    q = np.clip(np.round(uv * 65535), 0, 65535).astype(np.uint16)
    uv_all.append(q); index.append({'i': m['i'], 'tris': m['tris'], 'offset': o}); o += len(q)
np.concatenate(uv_all).tofile(os.path.join(outdir, 'lm-uv.bin'))
json.dump({'version': 1, 'format': 'webp', 'size': SIZE, 'range': RANGE, 'layers': list(LAYERS), 'meshes': index, 'samples': SAMPLES}, open(os.path.join(outdir, 'lm.json'), 'w'))
log('written to', outdir)
