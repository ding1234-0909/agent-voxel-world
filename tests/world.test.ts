import { describe, it, expect } from 'vitest';
import {terrain,key,simulate,validateEdit,parseInput} from '../packages/shared/src/index';
describe('authoritative world rules',()=>{
 it('generates deterministic terrain',()=>expect([...terrain()]).toEqual([...terrain()]));
 it('lands above ground and normalizes diagonal movement',()=>{
  const b={x:0,y:5,z:0,vy:0,grounded:false}; const world=terrain();
  for(let i=0;i<100;i++) simulate(b,{x:0,z:0,jump:false,yaw:0},world,.05);
  expect(b.y).toBeGreaterThanOrEqual(2.5); expect(b.y).toBeLessThan(2.58); expect(b.grounded).toBe(true);
  const start={...b}; simulate(b,{x:1,z:1,jump:false,yaw:0},world,.05); expect(Math.hypot(b.x-start.x,b.z-start.z)).toBeCloseTo(.2);
 });
 it('rejects conflict, reach, occupied body, bedrock and invalid inputs',()=>{
  const world=terrain(),actor={x:0,y:2.51,z:0};
  expect(validateEdit({x:2,y:3,z:0,material:'wood',revision:0},actor,[actor],world,0)).toBe(null);
  expect(validateEdit({x:2,y:3,z:0,material:'wood',revision:0},actor,[],world,1)).toBe('conflict');
  expect(validateEdit({x:0,y:3,z:0,material:'wood',revision:0},actor,[actor],world,0)).toBe('player-occupied');
  expect(validateEdit({x:10,y:8,z:0,material:'wood',revision:0},actor,[],world,0)).toBe('out-of-reach');
  expect(validateEdit({x:1,y:0,z:0,material:null,revision:0},actor,[],world,0)).toBe('bounds');
  expect(parseInput({x:NaN,z:0,yaw:0,jump:false})).toBe(null);
  expect(parseInput({x:100,z:0,yaw:0,jump:false})).toBe(null);
  expect(world.has(key({x:0,y:2,z:0}))).toBe(true);
 });
});
