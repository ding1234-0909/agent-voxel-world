import { Client, type Room } from 'colyseus.js';
import type { Snapshot, Edit, Player, Block, WorldEvent } from '@voxel/shared';
export type Observation={id:string;revision:number;self:Player;players:Player[];blocks:Block[];events:WorldEvent[];radius:number;allowedActions:string[]};
export type Result={id:string;ok:boolean;error?:string;revision:number};
export const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function until(predicate:()=>boolean,timeout=5000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw Error('Timed out waiting for state');await delay(25);}}
export class Session {
 room!:Room;client=new Client(process.env.SERVER_URL??'ws://127.0.0.1:2567');snapshot?:Snapshot;edits:Edit[]=[];events:WorldEvent[]=[];voice:unknown[]=[];
 private id=0;private pending=new Map<string,(value:any)=>void>();
 async join(name:string,kind='scripted-agent'){
  const endpoint=(process.env.SERVER_URL??'ws://127.0.0.1:2567').replace(/^ws/,'http');const info=await fetch(`${endpoint}/world`).then(r=>r.json()) as {roomId:string};
  this.attach(await this.client.joinById(info.roomId,{name,kind}));await until(()=>!!this.snapshot);return this;
 }
 attach(room:Room){
  this.room=room;room.onMessage('snapshot',(s:Snapshot)=>this.snapshot=s);room.onMessage('edit',(e:Edit)=>this.edits.push(e));room.onMessage('event',(e:WorldEvent)=>this.events.push(e));room.onMessage('voice',value=>this.voice.push(value));
  for(const type of ['result','observation'])room.onMessage(type,(value:{id:string})=>{this.pending.get(value.id)?.(value);this.pending.delete(value.id);});room.send('sync');
 }
 async request<T=Result>(type:string,payload:unknown={}):Promise<T>{
  const id=`agent-${++this.id}`;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`Timeout: ${type}`));},5000);this.pending.set(id,value=>{clearTimeout(timer);resolve(value);});this.room.send('action',{id,type,payload});});
 }
 move(x:number,z:number,jump=false){this.room.send('action',{id:`move-${++this.id}`,type:'move',payload:{x,z,jump,yaw:0}});}
 observe(){return this.request<Observation>('observe');}
 async reconnect(){const token=this.room.reconnectionToken;this.room.connection.close();await delay(200);this.attach(await this.client.reconnect(token));await delay(100);}
 async close(){await this.room?.leave();}
}
