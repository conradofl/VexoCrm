import './src/config/env.js';
import { runAutomationEngine } from './src/followup/automationEngine.js';

async function run() {
  console.log('Triggering engine...');
  await runAutomationEngine();
  console.log('Engine finished.');
  process.exit(0);
}
run().catch(console.error);
