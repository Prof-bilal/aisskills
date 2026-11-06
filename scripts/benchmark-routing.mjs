import assert from 'node:assert/strict';
import {evaluateCapabilityRouting} from '../packages/core/dist/index.js';

// A deterministic routing regression corpus, not a model quality/cost study.
const domains={frontend:['layout','responsive','interface'],supabase:['rls','postgres'],firebase:['firestore','realtime'],clerk:['organizations','identity'],stripe:['payments','checkout'],security:['vulnerability','secrets'],testing:['regression','assertions'],browser:['screenshot','reference']};
const candidates=Object.entries(domains).map(([id,triggers])=>({id,estimatedTokens:Math.ceil((`${id} workflow guidance. `.repeat(1000)).length/4),manifest:{id,description:id,capabilities:[id],activation:{triggers},dependencies:{skills:[]},compatible_agents:[]}}));
const cases=Object.entries(domains).flatMap(([id,triggers])=>[id,...triggers].map(term=>({task:`Implement ${term}`,expected:[id]})));
let baseline=0,selected=0,truePositive=0,falsePositive=0,falseNegative=0;const started=performance.now();
for(const c of cases){const result=evaluateCapabilityRouting(c.task,candidates,{budgetTokens:20000});const expected=new Set(c.expected);for(const id of result.selected)expected.has(id)?truePositive++:falsePositive++;for(const id of expected)if(!result.selected.includes(id))falseNegative++;baseline+=result.baselineTokens;selected+=result.estimatedTokens;assert.deepEqual(result.selected,c.expected,`Wrong selection for ${c.task}`);}
console.log(JSON.stringify({corpus:`${cases.length} deterministic domain fixtures`,tasks:cases.length,precision:truePositive/(truePositive+falsePositive),recall:truePositive/(truePositive+falseNegative),estimatedBaselineTokens:baseline,estimatedSelectedTokens:selected,estimatedReduction:1-selected/baseline,routingElapsedMs:performance.now()-started,limitations:['Character/4 estimates, not billed or tokenizer-measured usage','Does not measure model task success, native tool search, tool result tokens or remote startup latency']},null,2));
