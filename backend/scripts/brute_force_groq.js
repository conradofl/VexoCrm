import dotenv from 'dotenv';
dotenv.config();

const base = "gsk_Eck{1}R{2}tU{3}{4}YFusf7JW{5}RWGdyb3FYu4j{6}9{7}{8}zo{9}j59zg{10}6MkzVxVB";

const p1 = ['l', 'L', 'I', '1'];
const p2 = ['l', 'L', 'I', '1'];
const p3 = ['K', 'k'];
const p4 = ['K', 'k'];
const p5 = ['K', 'k'];
const p6 = ['l', 'L', 'I', '1'];
const p7 = ['N', 'n'];
const p8 = ['J', 'j'];
const p9 = ['A', 'a'];
const p10 = ['1', 'l', 'I'];

async function testKey(key) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (res.ok) {
      console.log("FOUND VALID KEY:", key);
      return true;
    }
  } catch(e) {}
  return false;
}

async function run() {
  console.log("Starting brute force with wider permutations...");
  for (const c1 of p1) {
    for (const c2 of p2) {
      for (const c3 of p3) {
        for (const c4 of p4) {
          for (const c5 of p5) {
            for (const c6 of p6) {
              for (const c7 of p7) {
                for (const c8 of p8) {
                  for (const c9 of p9) {
                    for (const c10 of p10) {
                      let k = base
                        .replace('{1}', c1)
                        .replace('{2}', c2)
                        .replace('{3}', c3)
                        .replace('{4}', c4)
                        .replace('{5}', c5)
                        .replace('{6}', c6)
                        .replace('{7}', c7)
                        .replace('{8}', c8)
                        .replace('{9}', c9)
                        .replace('{10}', c10);
                      let ok = await testKey(k);
                      if (ok) {
                        console.log(k);
                        process.exit(0);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  console.log("Not found.");
}
run();
