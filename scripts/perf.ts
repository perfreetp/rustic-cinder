import { computeStreamlines } from '../src/lib/streamlineEngine';
const scenarios: [string, any][] = [
  ['binary default', [{id:1,x:-3.2,z:0,mass:80},{id:2,x:3.2,z:0,mass:80}], {seedDensity:2,stepSize:0.12,maxLength:60,direction:'bidirectional'}],
  ['ring dense', Array.from({length:6},(_,i)=>{const a=i/6*Math.PI*2;return {id:i+1,x:Math.cos(a)*5.5,z:Math.sin(a)*5.5,mass:45};}), {seedDensity:20,stepSize:0.1,maxLength:80,direction:'bidirectional'}],
  ['extreme cap', [{id:1,x:0,z:0,mass:120}], {seedDensity:40,stepSize:0.2,maxLength:30,direction:'forward'}],
  ['interactive drag', [{id:1,x:-3,z:0,mass:80},{id:2,x:3,z:0,mass:80}], {seedDensity:8,stepSize:0.12,maxLength:60,direction:'bidirectional'}],
];
for (const [name, masses, params] of scenarios) {
  const interactive = name.includes('interactive');
  const t0 = performance.now();
  const r = computeStreamlines({msgId:1,masses,params,interactive}, ()=>false);
  console.log(
    name.padEnd(16),
    'lines=', String(r.lineCount).padStart(5),
    'points=', String(r.pointCount).padStart(7),
    'elapsed=', r.elapsedMs.toFixed(1).padStart(6)+'ms',
    r.truncated ? '(truncated)' : ''
  );
  void t0;
}
