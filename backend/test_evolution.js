import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const url = process.env.EVOLUTION_API_URL.replace(/\/+$/, '') + '/instance/connectionState/livpub-1782740139493-teste-1';
  const apikey = process.env.EVOLUTION_API_KEY;
  console.log('Fetching:', url);
  const res = await fetch(url, {
    headers: { 'apikey': apikey }
  });
  console.log(await res.text());
}
run();
