import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFObjectCopier, PDFPage, PDFRef, PDFString, PDFHexString, PDFPageLeaf } from 'pdf-lib';

export interface ExportedSourcePage { source: PDFDocument; sourcePage: number; page: PDFPage; }
const N = PDFName.of;

/** Copy page content/appearances without following navigation or field-parent
 * references into unselected source pages. Those connections are rebuilt below. */
export function copyInteractivePage(source:PDFDocument, pageNumber:number, output:PDFDocument):PDFPage {
  const original=source.getPage(pageNumber-1),node=original.node.clone(),annots=original.node.lookupMaybe(N('Annots'),PDFArray);
  if(annots){
    const clean=source.context.obj([]);
    for(let i=0;i<annots.size();i++){
      const annotation=source.context.lookupMaybe(annots.get(i),PDFDict);if(!annotation)continue;
      const copy=annotation.clone();copy.delete(N('P'));copy.delete(N('Parent'));copy.delete(N('Dest'));
      const action=annotation.lookupMaybe(N('A'),PDFDict);if(action?.get(N('S'))===N('GoTo'))copy.delete(N('A'));
      clean.push(copy);
    }
    node.set(N('Annots'),clean);
  }
  const copied=PDFObjectCopier.for(source.context,output.context).copy(node) as PDFPageLeaf;
  return PDFPage.of(copied,output.context.register(copied),output);
}

/** Rebind document-level navigation and field trees to the pages actually exported.
 * Page copying alone retains appearances, but leaves links/field parents pointing at
 * detached copies. Source objects are never modified. */
export function preservePdfInteractions(output: PDFDocument, pages: ExportedSourcePage[]): void {
  const groups = new Map<PDFDocument, ExportedSourcePage[]>();
  for (const page of pages) { const group=groups.get(page.source)??[];group.push(page);groups.set(page.source,group); }
  const roots: PDFRef[] = [], outlineRoots: PDFRef[] = [], rootNames = new Set<string>();
  const form = output.context.obj({Fields: []}), resources=output.context.obj({}), fonts=output.context.obj({});
  resources.set(N('Font'),fonts);form.set(N('DR'),resources);
  let groupIndex=0;
  for(const [source,entries] of groups){
    const copier=PDFObjectCopier.for(source.context,output.context), sourcePages=source.getPages();
    const mapping=new Map<string,PDFPage>();
    for(const entry of entries)if(!mapping.has(sourcePages[entry.sourcePage-1].ref.toString()))mapping.set(sourcePages[entry.sourcePage-1].ref.toString(),entry.page);
    const dict=(value:PDFObject|undefined):PDFDict|undefined=>value?source.context.lookupMaybe(value,PDFDict):undefined;
    const nameText=(value:PDFObject|undefined)=>value instanceof PDFString||value instanceof PDFHexString?value.decodeText():value instanceof PDFName?value.decodeText():undefined;
    const sourceForm=dict(source.catalog.get(N('AcroForm'))), sourceDR=dict(sourceForm?.get(N('DR')));
    const fontNames=new Map<string,string>();const prefix=`MS${++groupIndex}_`;
    const sourceFonts=dict(sourceDR?.get(N('Font')));
    if(sourceFonts)for(const [key,value] of sourceFonts.entries()){const renamed=prefix+key.decodeText();fontNames.set(key.toString(),N(renamed).toString());fonts.set(N(renamed),copier.copy(value));}
    const copyDA=(value:PDFObject)=>{
      const text=nameText(value);return text===undefined?copier.copy(value):PDFString.of(text.replace(/\/[^\s/]+(?=\s+[-\d.]+\s+Tf\b)/g,key=>fontNames.get(key)??key));
    };
    const namedDestination=(name:string):PDFObject|undefined=>{
      const old=dict(source.catalog.get(N('Dests')))?.get(N(name));if(old)return old;
      const walk=(tree:PDFDict|undefined):PDFObject|undefined=>{
        const names=tree?.lookupMaybe(N('Names'),PDFArray);
        if(names)for(let i=0;i+1<names.size();i+=2)if(nameText(names.get(i))===name)return names.get(i+1);
        const kids=tree?.lookupMaybe(N('Kids'),PDFArray);if(kids)for(let i=0;i<kids.size();i++){const found=walk(dict(kids.get(i)));if(found)return found;}
        return undefined;
      };return walk(dict(dict(source.catalog.get(N('Names')))?.get(N('Dests'))));
    };
    const destination=(value:PDFObject|undefined,depth=0):PDFArray|undefined=>{
      if(!value||depth>10)return undefined;
      const text=nameText(value);if(text!==undefined)return destination(namedDestination(text),depth+1);
      const resolved=source.context.lookup(value);
      if(resolved instanceof PDFDict)return destination(resolved.get(N('D')),depth+1);
      if(!(resolved instanceof PDFArray)||!resolved.size())return undefined;
      const first=resolved.get(0);const ref=first instanceof PDFNumber?sourcePages[first.asNumber()]?.ref:first;
      const target=ref&&mapping.get(ref.toString());if(!target)return undefined;
      const result=output.context.obj([]);result.push(target.ref);
      for(let i=1;i<resolved.size();i++)result.push(copier.copy(resolved.get(i)));
      return result;
    };
    const rebindNavigation=(from:PDFDict,to:PDFDict):boolean=>{
      if(from.has(N('Dest'))){const dest=destination(from.get(N('Dest')));if(!dest)return false;to.set(N('Dest'),dest);}
      const action=dict(from.get(N('A')));
      if(action?.get(N('S'))===N('GoTo')){const dest=destination(action.get(N('D')));if(!dest)return false;const copy=output.context.obj({});for(const [k,v] of action.entries())if(k!==N('D'))copy.set(k,copier.copy(v));copy.set(N('D'),dest);to.set(N('A'),copy);}
      if(action&&action.get(N('S'))!==N('GoTo'))to.set(N('A'),copier.copy(action));
      return true;
    };
    const fields=new Map<PDFDict,{dict:PDFDict;ref:PDFRef}>();
    const parentField=(original:PDFDict):{dict:PDFDict;ref:PDFRef}=>{
      const found=fields.get(original);if(found)return found;
      const copied=output.context.obj({Kids:[]}),ref=output.context.register(copied),result={dict:copied,ref};fields.set(original,result);
      for(const [k,v] of original.entries())if(!['Kids','Parent','P'].includes(k.decodeText()))copied.set(k,k===N('DA')?copyDA(v):copier.copy(v));
      const parent=dict(original.get(N('Parent')));
      if(parent){const ancestor=parentField(parent);copied.set(N('Parent'),ancestor.ref);ancestor.dict.lookup(N('Kids'),PDFArray).push(ref);}
      else {uniqueRoot(copied);roots.push(ref);}
      return result;
    };
    const uniqueRoot=(field:PDFDict)=>{
      const original=nameText(field.get(N('T')));if(original===undefined)return;
      let name=original,index=2;while(rootNames.has(name))name=`${original} (${index++})`;
      rootNames.add(name);if(name!==original)field.set(N('T'),PDFString.of(name));
    };
    for(const entry of entries){
      const originalAnnots=sourcePages[entry.sourcePage-1].node.lookupMaybe(N('Annots'),PDFArray),copiedAnnots=entry.page.node.lookupMaybe(N('Annots'),PDFArray);
      if(!originalAnnots||!copiedAnnots)continue;
      const kept=output.context.obj([]);
      for(let i=0;i<originalAnnots.size();i++){
        const original=dict(originalAnnots.get(i)),copied=output.context.lookupMaybe(copiedAnnots.get(i),PDFDict);if(!original||!copied)continue;
        if(!rebindNavigation(original,copied))continue;
        const ref=copiedAnnots.get(i) instanceof PDFRef?copiedAnnots.get(i) as PDFRef:output.context.register(copied);
        kept.push(ref);copied.set(N('P'),entry.page.ref);
        if(original.get(N('Subtype'))===N('Widget')){
          const parent=dict(original.get(N('Parent')));copied.delete(N('Parent'));
          if(parent){const field=parentField(parent);field.dict.lookup(N('Kids'),PDFArray).push(ref);copied.set(N('Parent'),field.ref);}
          else {uniqueRoot(copied);roots.push(ref);}
          const da=original.get(N('DA'));if(da)copied.set(N('DA'),copyDA(da));
          else if(!parent&&sourceForm?.get(N('DA')))copied.set(N('DA'),copyDA(sourceForm.get(N('DA'))!));
        }
      }
      entry.page.node.set(N('Annots'),kept);
    }
    // Keep default appearance inherited from the source form on each root, since
    // merged documents can have different font resources/default font sizes.
    for(const {dict:field} of fields.values())if(!field.has(N('Parent'))&&!field.has(N('DA'))&&sourceForm?.get(N('DA')))field.set(N('DA'),copyDA(sourceForm.get(N('DA'))!));
    const seen=new Set<PDFDict>();
    const outline=(first:PDFObject|undefined):PDFRef[]=>{
      const result:PDFRef[]=[];let current=dict(first);
      while(current&&!seen.has(current)){
        seen.add(current);const children=outline(current.get(N('First'))),copy=output.context.obj({});
        for(const [k,v] of current.entries())if(!['Parent','Prev','Next','First','Last','Count','Dest','A'].includes(k.decodeText()))copy.set(k,copier.copy(v));
        const hasNavigation=current.has(N('Dest'))||current.has(N('A')),valid=rebindNavigation(current,copy);
        if((hasNavigation&&valid)||children.length){
          if(!valid){copy.delete(N('Dest'));copy.delete(N('A'));}
          const ref=output.context.register(copy);if(children.length)connect(children,ref);result.push(ref);
        }
        current=dict(current.get(N('Next')));
      }
      return result;
    };
    const connect=(items:PDFRef[],parent:PDFRef)=>{
      const owner=output.context.lookup(parent,PDFDict);owner.set(N('First'),items[0]);owner.set(N('Last'),items[items.length-1]);let count=0;
      items.forEach((ref,i)=>{const item=output.context.lookup(ref,PDFDict);item.set(N('Parent'),parent);if(i)item.set(N('Prev'),items[i-1]);if(i+1<items.length)item.set(N('Next'),items[i+1]);count+=1+(item.lookupMaybe(N('Count'),PDFNumber)?.asNumber()??0);});owner.set(N('Count'),PDFNumber.of(count));
    };
    outlineRoots.push(...outline(dict(source.catalog.get(N('Outlines')))?.get(N('First'))));
  }
  // A terminal field with one widget can use the standard merged field/widget
  // representation. PDFKit writes the widget's V when editing; merging avoids a
  // second, stale parent V while keeping hierarchical names and multi-widget fields.
  const mergeSingleWidget=(ref:PDFRef):PDFRef=>{
    const field=output.context.lookup(ref,PDFDict),kids=field.lookupMaybe(N('Kids'),PDFArray);
    if(!kids)return ref;
    if(field.has(N('FT'))&&kids.size()===1){
      const widgetRef=kids.get(0),widget=output.context.lookupMaybe(widgetRef,PDFDict);
      if(widget&&widget.get(N('Subtype'))===N('Widget')&&widgetRef instanceof PDFRef){
        for(const [key,value] of field.entries())if(key!==N('Kids'))widget.set(key,value);
        if(!field.has(N('Parent')))widget.delete(N('Parent'));
        return widgetRef;
      }
    }
    for(let i=0;i<kids.size();i++){const child=kids.get(i);if(child instanceof PDFRef)kids.set(i,mergeSingleWidget(child));}
    return ref;
  };
  if(roots.length){const array=output.context.obj(roots.map(mergeSingleWidget));form.set(N('Fields'),array);output.catalog.set(N('AcroForm'),output.context.register(form));}
  if(outlineRoots.length){
    const root=output.context.obj({Type:'Outlines',First:outlineRoots[0],Last:outlineRoots[outlineRoots.length-1],Count:outlineRoots.reduce((count,item)=>count+1+(output.context.lookup(item,PDFDict).lookupMaybe(N('Count'),PDFNumber)?.asNumber()??0),0)}),ref=output.context.register(root);
    outlineRoots.forEach((item,i)=>{const d=output.context.lookup(item,PDFDict);d.set(N('Parent'),ref);if(i)d.set(N('Prev'),outlineRoots[i-1]);if(i+1<outlineRoots.length)d.set(N('Next'),outlineRoots[i+1]);});output.catalog.set(N('Outlines'),ref);
  }
}

/** Write the user-edited document TOC after page copying; no source objects are mutated. */
export function writeDocumentOutline(output: PDFDocument, items: {title:string;page:number;level:number}[], exportedPages: number[]):void {
  type Branch={title:string;page:number;level:number;children:Branch[]};
  const roots:Branch[]=[],stack:Branch[]=[];
  for(const item of items){
    while(stack.length&&stack[stack.length-1].level>=item.level)stack.pop();
    const branch={...item,children:[] as Branch[]};(stack.length?stack[stack.length-1].children:roots).push(branch);stack.push(branch);
  }
  const prune=(nodes:Branch[]):Branch[]=>nodes.flatMap(node=>{const children=prune(node.children),index=exportedPages.indexOf(node.page);return index<0&&!children.length?[]:[{...node,page:index,children}];});
  const tree=prune(roots);output.catalog.delete(N('Outlines'));if(!tree.length)return;
  const root=output.context.obj({Type:'Outlines'}),rootRef=output.context.register(root);
  const write=(nodes:Branch[],parent:PDFRef):{refs:PDFRef[];count:number}=>{
    const dictionaries=nodes.map(()=>output.context.obj({})),refs=dictionaries.map(node=>output.context.register(node));let count=0;
    nodes.forEach((node,index)=>{const dict=dictionaries[index];dict.set(N('Title'),PDFHexString.fromText(node.title));dict.set(N('Parent'),parent);
      if(index)dict.set(N('Prev'),refs[index-1]);if(index+1<refs.length)dict.set(N('Next'),refs[index+1]);
      if(node.page>=0)dict.set(N('Dest'),output.context.obj([output.getPage(node.page).ref,'Fit']));
      if(node.children.length){const children=write(node.children,refs[index]);dict.set(N('First'),children.refs[0]);dict.set(N('Last'),children.refs[children.refs.length-1]);dict.set(N('Count'),PDFNumber.of(children.count));count+=children.count;}
      count++;
    });return {refs,count};
  };
  const result=write(tree,rootRef);root.set(N('First'),result.refs[0]);root.set(N('Last'),result.refs[result.refs.length-1]);root.set(N('Count'),PDFNumber.of(result.count));output.catalog.set(N('Outlines'),rootRef);
}
