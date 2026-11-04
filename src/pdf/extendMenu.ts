import { setIcon, Notice } from "obsidian";
import { el } from "../utils/dom";

export interface ExtendAction { id: string; label: string; icon?: string; text?: boolean; color?: string; pressed?: boolean; run: () => void | Promise<void>; }
/** Native menu symbols use solid silhouettes; other actions keep the host icon set. */
export function setMenuIcon(button: HTMLElement, icon: string): void {
  const shapes: Record<string, string> = {
    "notebook-pen": '<path d="M3 4h16v10M3 4v16h9M6 8h10M6 11h8M6 14h5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m13 18 6-6 3 3-6 6-4 1z" fill="currentColor"/>',
    "palette": '<path fill="currentColor" fill-rule="evenodd" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10h1c2 0 3-1 3-2.5 0-1-1-1.5-1-2.5 0-1 .8-1.8 1.8-1.8H19c2 0 3-1.3 3-3.2C22 6.5 17.5 2 12 2ZM8 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6-1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM5 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm3 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/>',
    "sparkles": '<path fill="currentColor" d="M10 1c1.5 6 3 7.5 9 9-6 1.5-7.5 3-9 9-1.5-6-3-7.5-9-9 6-1.5 7.5-3 9-9Zm10 13c.7 3 1.3 3.6 4 4.3-2.7.7-3.3 1.3-4 4.2-.7-2.9-1.3-3.5-4-4.2 2.7-.7 3.3-1.3 4-4.3Z"/>',
    "tag": '<path fill="currentColor" fill-rule="evenodd" d="M3 3h8l10 10-8 8L3 11V3Zm4 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/>',
    "trash-2": '<path fill="currentColor" d="M8 2h8l1 2h4v2H3V4h4l1-2ZM5 7h14l-1.5 15h-11L5 7Z"/>',
  };
  const shape=shapes[icon];
  if(!shape){setIcon(button,icon);return;}
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");svg.innerHTML=shape;button.append(svg);
}
/** A single anchored popover, shared by expanded notes and collapsed note previews. */
export function openExtendMenu(parent: HTMLElement, anchor: HTMLElement, basic: ExtendAction[], advanced: ExtendAction[], favorites: string[], saveFavorites: (ids: string[]) => void, state?: {tab: string}): () => void {
  const menu=el("div",{class:"ms-extend-menu",role:"dialog","aria-label":"留白操作"}), tabs=el("div",{class:"ms-extend-menu-tabs",role:"tablist"}), row=el("div",{class:"ms-extend-menu-actions",role:"tabpanel"});
  menu.append(tabs,row);parent.append(menu);let active=state&&["Basic","Advanced","Favorites"].includes(state.tab)?state.tab:"Basic",customizing=false;
  const all=[...basic,...advanced];
  const close=()=>{document.removeEventListener("pointerdown",outside,true);document.removeEventListener("keydown",key,true);menu.remove();};
  const outside=(event:Event)=>{if(!menu.contains(event.target as Node)&&!anchor.contains(event.target as Node))close();};
  const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.stopPropagation();close();anchor.focus();}};
  const position=()=>{const bounds=anchor.getBoundingClientRect(),size=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(innerWidth-size.width-8,bounds.right-size.width*.5))}px`;menu.style.top=`${bounds.bottom+size.height+12<innerHeight?bounds.bottom+10:Math.max(8,bounds.top-size.height-10)}px`;};
  const draw=()=>{
    menu.dataset.tab=active;
    tabs.querySelectorAll("button").forEach(node=>node.setAttribute("aria-selected",String(node.textContent===active)));row.replaceChildren();
    const actions=active==="Basic"?basic:active==="Advanced"?advanced:customizing?all:all.filter(action=>favorites.includes(action.id));
    menu.dataset.actionCount=String(actions.length);
    for(const action of actions){const button=el("button",{"aria-label":action.label,title:action.label,"data-action":action.id});
      if(action.color){button.classList.add("ms-extend-color");button.style.setProperty("--ms-extend-color",action.color);button.setAttribute("aria-pressed",String(action.pressed));}
      else if(action.text)button.textContent=action.label;else if(action.icon)setMenuIcon(button,action.icon);
      if(customizing){button.setAttribute("aria-pressed",String(favorites.includes(action.id)));button.addEventListener("click",()=>{favorites=favorites.includes(action.id)?favorites.filter(id=>id!==action.id):[...favorites,action.id];saveFavorites(favorites);draw();});}
      else button.addEventListener("click",()=>{close();void Promise.resolve().then(action.run).catch(error=>new Notice(String(error)));});row.append(button);
    }
    if(active==="Favorites"){const add=el("button",{"aria-label":customizing?"完成收藏设置":"自定义收藏",title:customizing?"完成收藏设置":"自定义收藏",class:"ms-extend-customize"});setIcon(add,customizing?"check":"circle-plus");add.addEventListener("click",()=>{customizing=!customizing;draw();});row.append(add);}
    position();
  };
  for(const label of ["Basic","Advanced","Favorites"]){const tab=el("button",{role:"tab",text:label,"aria-label":label,"aria-selected":String(label===active)});tab.addEventListener("click",()=>{active=label;if(state)state.tab=label;customizing=false;draw();});tabs.append(tab);}
  document.addEventListener("pointerdown",outside,true);document.addEventListener("keydown",key,true);draw();return close;
}
