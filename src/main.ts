/** Browser bootstrap: styles are bundled by Vite; the shell itself is pre-rendered from TSX. */
import '../styles/styles.css';
import { TrackerApplication } from './app/TrackerApplication';

new TrackerApplication().start();
