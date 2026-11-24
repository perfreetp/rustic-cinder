import * as THREE from 'three';

/**
 * 程序化摄影棚环境: 主光柔光箱 + 两侧轮廓光 + 顶部天光 + 地面反射带。
 * 用 PMREM 生成, 因此哑光材质上的高光与反射都来自真实的 HDR 环境。
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();

  const room = new THREE.Mesh(
    new THREE.BoxGeometry(20, 12, 20),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.035, 0.038, 0.045), side: THREE.BackSide }),
  );
  env.add(room);

  const panel = (
    w: number,
    h: number,
    color: THREE.ColorRepresentation,
    intensity: number,
    pos: [number, number, number],
    lookAt: [number, number, number] = [0, 0, 0],
    round = false,
  ) => {
    const geo = round ? new THREE.CircleGeometry(Math.min(w, h) / 2, 48) : new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    mat.color.multiplyScalar(intensity);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.lookAt(new THREE.Vector3(...lookAt));
    env.add(mesh);
    return mesh;
  };

  // 主柔光箱 (右上前方)
  panel(9, 7, 0xfff6ec, 5.4, [5.2, 5.0, 6.2]);
  // 左侧轮廓光 (冷)
  panel(6, 8, 0xbcd4ff, 2.1, [-6.6, 2.2, 2.4]);
  // 右侧轮廓光 (暖)
  panel(5, 7, 0xffdfb8, 1.7, [6.8, 1.4, -3.4]);
  // 顶部天光
  panel(12, 12, 0xdfe9ff, 1.5, [0, 7.2, 0], [0, 0, 0]);
  // 背后柔光
  panel(10, 6, 0xffffff, 0.9, [0, 1.2, -8.4]);
  // 地面反光条 (为哑光表面提供下缘提亮)
  panel(18, 5, 0x2e3644, 1.6, [0, -3.6, 1.0], [0, 0, 0]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromScene(env, 0.035, 0.1, 100);
  pmrem.dispose();
  room.geometry.dispose();
  (room.material as THREE.Material).dispose();
  env.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return target.texture;
}
