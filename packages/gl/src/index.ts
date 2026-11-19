/**
 * @nostalgia/gl — a small WebGL2 engine for the 3D games: flat-shaded low-poly meshes lit by
 * one sun, exponential fog into a gradient sky, soft round particles; instanced props,
 * translucent meshes, ground shadows, height mist and a thermal view; and the pure helpers
 * around it (matrices, mesh parts, height-field chunks, instance data, value noise).
 *
 *   import { createGL, builder, box, modelOf } from '@nostalgia/gl';
 *
 *   const R = createGL(canvas, { antialias: !demo, stencil: true });   // null without WebGL2
 *   const B = builder(); box(B, { at: [0, 1, 0] }, [2, 2, 2], '#c8c2b4');
 *   const buf = R.buffer(B.data());                       // [0, B.n] is the mesh's range
 *   // each frame, in this order:
 *   R.frame(cam, sky);                                     // clear, sky; cam: { eye, f, u, fov, near, far }
 *   if (R.visible(centre, radius)) R.drawStatic(buf, first, count);
 *   R.drawMesh(buf, [first, count], modelOf(pos, fwd, up, scale), tint, cull);
 *   R.drawInstanced(buf, treeRange, ib, first, count, { far: 1800, fade: 200 });
 *   R.drawShadow(buf, heliRange, model, groundPlane, 0.45, dir);  // or R.drawBlob(c, r, n, alpha)
 *   R.drawMesh(buf, discRange, model, tint, false, 0.25);  // translucent: alpha < 1, far to near
 *   R.drawPoints(f32, n);                                  // 8 floats each: x y z size r g b a (premultiplied)
 *   R.destroy();                                           // frees its own objects, keeps the context
 *
 * Vertices are 20 bytes: position f32 × 3, normal i8 × 4, colour u8 × 4 whose alpha is the
 * "kind": 255 lit, 128 water (a sun glint), 0 glowing (unlit). Mesh space: x right, y up, z
 * back (noses point −z), metres. A sky is { zenith, horizon, haze, sunCol, sunN, ambient, fog,
 * mist? } with mist { top, density, col? }: extra fog lying below `top`. R.state holds the last
 * frame's vp / view / proj matrices, eye, focal length (pixels) and frustum planes, for culling
 * and projecting HUD symbols. R.features says what this build can do.
 *
 * Instances: R.instances(f32) uploads 9 floats each — x y z yaw width height r g b (the mesh
 * turned about +y as a part's `yaw`, x/z scaled by width, y by height, colour multiplied) —
 * and returns { count, update(f32), destroy() }. instanceData() packs objects into that layout,
 * groupInstances() sorts them into contiguous runs per terrain chunk (draw a run per visible
 * chunk), cullInstances() compacts a moving set. drawInstanced()'s { near, far, fade } dither an
 * instance out across a band centred on each edge, so two LODs cross-fade where one's `far`
 * is the other's `near`; beyond it the instance costs only its vertex shader.
 *
 * Shadows: drawShadow() flattens a mesh along `dir` (default the sun; pass something nearer
 * straight down when the sun is low) onto a plane [nx, ny, nz, d] (from gridNormal() under the
 * aircraft), fogged; with `stencil: true` each call darkens a pixel only once. drawBlob() is a
 * soft disc. Both go after the opaque draws, before the translucent ones.
 *
 * Thermal: frame(cam, sky, { thermal: true }) draws everything on a white-hot green-grey ramp
 * by brightness; R.heat(0..1) makes the following draws hotter (engines, vehicles; reset each
 * frame). frame(cam, sky, { viewport: [x, y, w, h] }) draws into a scissored inset (a sight
 * on a cockpit display) after the main view; R.state then holds the inset's camera.
 *
 * destroy() never calls loseContext(): the launcher turns a demo into the game on the same
 * canvas, and the next createGL() must get a working context back.
 *
 * DOM-free subpaths, for sims and Node tools: '@nostalgia/gl/noise' (hash2, fbm, ridged, smooth,
 * lerp, polyDist, polyAt, polyLen), '/math' (hexRGB, perspective, viewOf, modelOf, mul4,
 * invert4, planes, sphereVisible), '/mesh' (builder, box, frustum, cyl, loft, plate, fin, xf),
 * '/terrain' (gridHeight, gridNormal, gridChunks, flatCell, gridCoarse). '@nostalgia/gl/ui' is
 * the 2D HUD helper (createUI(ctx, { font }), the W × H reference frame, F, COL, fmt).
 */
export * from './gl.ts';
export * from './instances.ts';
export * from './math.ts';
export * from './mesh.ts';
export * from './noise.ts';
export * from './terrain.ts';
