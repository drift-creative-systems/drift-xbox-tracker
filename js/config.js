/**
 * Where the Worker lives. This isn't a secret: the Worker checks the login.
 * On localhost the app talks to `npm run dev` in worker/.
 */

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
const LOCAL_WORKER_URL = 'http://localhost:8787';
const PRODUCTION_WORKER_URL = 'https://drift-xbox-tracker-proxy.YOUR-SUBDOMAIN.workers.dev';

export const WORKER_URL = (LOCAL_HOSTS.includes(location.hostname) ? LOCAL_WORKER_URL : PRODUCTION_WORKER_URL).replace(/\/+$/, '');
