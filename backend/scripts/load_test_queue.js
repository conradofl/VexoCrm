import dotenv from 'dotenv';
dotenv.config();

import { getFollowupQueue } from '../src/followup/queue.js';
import { performance } from 'perf_hooks';

async function run() {
  const queue = getFollowupQueue();
  const NUM_JOBS = 5000;
  
  console.log(`Iniciando injeção de ${NUM_JOBS} jobs no BullMQ...`);
  const startTime = performance.now();
  
  // We can insert jobs individually or in bulk.
  // Using addBulk is much more efficient for this scale.
  const jobs = [];
  for (let i = 0; i < NUM_JOBS; i++) {
    jobs.push({
      name: 'followup-test',
      data: { isMock: true, jobId: `mock-${i}` }
    });
  }
  
  // Chunking to avoid memory explosion if the array is too big for the Redis pipeline
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    const chunk = jobs.slice(i, i + CHUNK_SIZE);
    await queue.addBulk(chunk);
    console.log(`Enfileirados: ${i + chunk.length} / ${NUM_JOBS}`);
  }
  
  const endTime = performance.now();
  console.log(`✅ Injeção concluída em ${((endTime - startTime) / 1000).toFixed(2)}s`);
  
  console.log('Fique de olho no terminal do seu worker para ver a drenagem da fila.');
  console.log('Fechando conexão de script...');
  process.exit(0);
}

run().catch(console.error);
