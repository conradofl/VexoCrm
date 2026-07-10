import dotenv from "dotenv";
dotenv.config();
const apiKey = process.env.EVOLUTION_API_KEY;
const url = process.env.EVOLUTION_API_URL;
fetch(`${url}/instance/fetchInstances?instanceName=livpub-teste1`, {
  headers: { apikey: apiKey }
}).then(res => res.json()).then(console.log).catch(console.error);
