export type Project={id:string;name:string;topic:string;status:string;currentStage:string;targetDurationSec?:number;budgetCents?:number;updatedAt:string};
export type Scene={id:string;sceneNumber:number;narration:string;durationMs:number;status:string;imagePrompt?:string;motionPrompt?:string};
const base=process.env.NEXT_PUBLIC_API_URL||"http://localhost:3000/api";
async function request<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(`${base}${path}`,{...init,headers:{"Content-Type":"application/json",...(init?.headers||{})}});if(!res.ok)throw new Error(await res.text()||`API ${res.status}`);return res.json()}
export const api={
 projects:{list:()=>request<Project[]>("/projects"),get:(id:string)=>request<Project>(`/projects/${id}`),create:(body:unknown)=>request<Project>("/projects",{method:"POST",body:JSON.stringify(body)})},
 scenes:{list:(id:string)=>request<Scene[]>(`/projects/${id}/scenes`),approve:(id:string)=>request(`/scenes/${id}/approve`,{method:"POST"}),regenerate:(id:string)=>request(`/scenes/${id}/visuals`,{method:"POST"})},
 jobs:{list:()=>request("/jobs")}, assets:{list:()=>request("/assets")}, approvals:{list:(id:string)=>request(`/projects/${id}/approvals`)}, channels:{list:()=>request("/channels")}
};
