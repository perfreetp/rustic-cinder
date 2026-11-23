import { createSignal, onCleanup, onMount } from "solid-js";
import { createEngine, engineLabel, HelixScene } from "./helixScene";

/**
 * 在组件中挂载一个双螺旋场景:创建引擎(WebGPU 优先)、
 * 运行渲染循环,组件卸载时自动释放。
 */
export function useHelixScene(getCanvas: () => HTMLCanvasElement) {
  const [helix, setHelix] = createSignal<HelixScene>();
  const [engineName, setEngineName] = createSignal("初始化中…");

  onMount(() => {
    let alive = true;
    createEngine(getCanvas()).then((engine) => {
      if (!alive) {
        engine.dispose();
        return;
      }
      const h = new HelixScene(engine, getCanvas());
      setEngineName(engineLabel(engine));
      setHelix(h);
      engine.runRenderLoop(() => h.scene.render());
    });
    const onResize = () => helix()?.engine.resize();
    window.addEventListener("resize", onResize);
    onCleanup(() => {
      alive = false;
      window.removeEventListener("resize", onResize);
      const h = helix();
      if (h) {
        h.dispose();
        h.engine.dispose();
      }
    });
  });

  return { helix, engineName };
}
