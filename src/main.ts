import { mount } from "svelte";
import App from "./App.svelte";
import { studio } from "./state/state.svelte";
import "./app.css";

// 调试/自动化测试钩子:暴露与 UI 完全相同的状态实例
declare global {
  interface Window {
    __studio?: typeof studio;
  }
}
window.__studio = studio;

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
