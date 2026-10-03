import './styles.css';
import { mountSources } from './sources';

if (location.hash === '#sources') {
  mountSources();
} else {
  void import('./manager').then(({ mountManager }) => mountManager());
}
