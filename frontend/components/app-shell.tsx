"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, Radio, ListTodo, Images, Clapperboard, ServerCog, Settings2, Search, Plus } from "lucide-react";

const groups=[
  {label:"WORKSPACE",items:[['Dashboard','/dashboard',LayoutDashboard],['Projects','/projects',FolderKanban],['Channels','/channels',Radio]]},
  {label:"PRODUCTION",items:[['Queue','/queue',ListTodo],['Assets','/assets',Images],['Templates','/templates',Clapperboard]]},
  {label:"SYSTEM",items:[['Providers','/providers',ServerCog],['Settings','/settings',Settings2]]}
] as const;
export function AppShell({children,title='Production'}:{children:React.ReactNode;title?:string}){
 const pathname=usePathname();
 return <div className="app"><aside className="sidebar"><div className="brand">TubeGen <span>OS</span></div>{groups.map(g=><div key={g.label}><div className="section">{g.label}</div>{g.items.map(([label,href,Icon])=><Link key={href} href={href} className={`nav ${pathname===href||pathname.startsWith(href+'/')?'active':''}`}><Icon size={14}/><span>{label}</span></Link>)}</div>)}<div className="sidebarBottom"><div className="workspaceMini"><span className="avatar">A</span><div><b>AutoDoc</b><small>Production workspace</small></div></div></div></aside><main className="main"><header className="topbar"><div className="crumb">Workspace / {title}</div><div className="topActions"><button className="iconBtn" aria-label="Search"><Search size={15}/></button><Link className="btn primary" href="/projects/new"><Plus size={14}/> New project</Link><span className="status processing"><i className="dot"/>Live state</span></div></header><div className="content">{children}</div></main></div>
}
