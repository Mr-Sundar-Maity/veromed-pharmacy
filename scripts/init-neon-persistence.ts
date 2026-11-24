import 'dotenv/config';
import { initializePersistenceSchema } from '../server/persistence';

await initializePersistenceSchema();
console.log('Neon persistence schema is ready.');
