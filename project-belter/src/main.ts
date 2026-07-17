import './ui/styles.css';
import './app/DebugBridge';
import { GameApp } from './app/GameApp';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) {
  throw new Error('Project Belter requires an #app root element.');
}

const app = new GameApp(root);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.destroy();
  });
}
