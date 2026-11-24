import {test} from 'node:test'
import assert from 'node:assert/strict'
import {GenerationCounter} from '../src/index.js'

// Lightweight in-memory implementation of the SQL calls used by the counter.
function mockCtx(){
  let count=0
  return {storage:{sql:{exec(query,limit){
    if(query.startsWith('SELECT')) return {one:()=>({used:count})}
    if(query.startsWith('UPDATE usage SET used = used + 1')) count++
    if(query.startsWith('UPDATE usage SET used = MAX')) count=Math.max(0,count-1)
    return {one:()=>({used:count})}
  }}}}
}
async function command(counter,action,limit=5){const response=await counter.fetch(new Request('https://counter.internal/',{method:'POST',body:JSON.stringify({action,limit})}));return response.json()}

test('five successful reservations, sixth blocked, then refund',async()=>{
  const counter = new GenerationCounter(mockCtx())
  for(let i=0;i<5;i++) assert.equal((await command(counter,'reserve')).allowed,true)
  assert.equal((await command(counter,'reserve')).allowed,false)
  assert.equal((await command(counter,'status')).remaining,0)
  await command(counter,'refund')
  assert.equal((await command(counter,'reserve')).allowed,true)
})
