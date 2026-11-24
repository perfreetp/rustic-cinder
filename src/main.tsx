import { render } from 'solid-js/web';
import './index.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root 未找到');

render(() => <App />, root);
