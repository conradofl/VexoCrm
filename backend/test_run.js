import dotenv from 'dotenv';
dotenv.config();

import { triggerAutomationRun } from './src/followup/automationEngine.js';

async function run() {
  console.log('Triggering engine...');
  triggerAutomationRun();
  console.log('Engine finished (runs in background).');
}
run().catch(console.error);
