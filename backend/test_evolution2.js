import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const url = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '') + '/instance/connectionState/livpub-1782740139493-teste-1';
  const apikey = process.env.EVOLUTION_API_KEY;
  console.log('URL:', url, 'Key exists:', !!apikey);
  if (!apikey) {
     console.log("No config, reading from running process is not easy. Let's just create the Vexo endpoint.");
  }
}
run();
