const base=process.env.NEXT_PUBLIC_API_URL||"http://localhost:3000/api";
export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
export async function request<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(`${base}${path}`,{...init,headers:{Accept:'application/json','Content-Type':'application/json',...(init?.headers||{})},credentials:'include',cache:'no-store'});if(!res.ok)throw new ApiError(res.status,await res.text()||`API ${res.status}`);return res.json()}
export {base as apiBase};
