import {useEffect,useState} from 'react';
import {supabaseBrowserClient} from '../../lib/supabase/browser';

type Contact={id:string;full_name:string;title:string|null;professional_email:string|null;email_verification_status:string;last_verified_at:string|null;source_evidence:Array<{url?:string;excerpt?:string}>};
export function AudienceContacts({productId,audienceId,refreshKey}:{productId:string;audienceId:string;refreshKey:string}) {
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(0);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let current=true;
    async function load(){
      setLoading(true);setError(null);
      const members=await supabaseBrowserClient.from('sales_os_audience_members').select('contact_id').eq('tenant_id','sales_os').eq('product_id',productId).eq('audience_id',audienceId).not('contact_id','is',null).limit(500);
      if (members.error) throw members.error;
      const ids=[...new Set((members.data??[]).map(row=>row.contact_id as string))];
      if (!ids.length) {if(current)setContacts([]);return;}
      const result=await supabaseBrowserClient.from('sales_os_contacts').select('id,full_name,title,professional_email,email_verification_status,last_verified_at,source_evidence').eq('tenant_id','sales_os').eq('product_id',productId).in('id',ids).order('full_name');
      if(result.error)throw result.error;
      if(current)setContacts((result.data??[]) as Contact[]);
    }
    void load().catch(()=>{if(current)setError('Unable to load contacts for this audience.');}).finally(()=>{if(current)setLoading(false);});
    return ()=>{current=false;};
  },[productId,audienceId,refreshKey,retry]);
  if(loading)return <p role="status" className="muted">Loading contacts…</p>;
  if(error)return <div role="alert"><p>{error}</p><button type="button" className="button-secondary" onClick={()=>setRetry(value=>value+1)}>Retry loading contacts</button></div>;
  if(!contacts.length)return null;
  const filtered=contacts.filter(contact=>[contact.full_name,contact.title,contact.professional_email].some(value=>value?.toLowerCase().includes(query.toLowerCase())));
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/10)-1));
  return <section className="audience-contacts" aria-label="Discovered contacts">
    <div className="card-heading"><h4>Contacts</h4><span className="muted">{contacts.length} discovered{contacts.length===500?' (first 500)':''}</span></div>
    <label>Find a contact<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}} placeholder="Name, role, or email" /></label>
    <div className="stack">
      {filtered.slice(currentPage*10,currentPage*10+10).map(contact=><article key={contact.id} className="route-row">
        <div><strong>{contact.full_name}</strong><p className="muted">{contact.title || 'Role not recorded'}</p>
        <p>{contact.professional_email || 'Email not found yet'}</p>
        <span className="status-pill">{contact.professional_email ? `Email ${contact.email_verification_status}` : 'Needs enrichment'}</span>
        {contact.last_verified_at && <p className="muted">Verified {new Date(contact.last_verified_at).toLocaleDateString()}</p>}
        <details><summary>Contact evidence</summary>{contact.source_evidence?.map((item,index)=><p key={index}>{item.excerpt}{item.url && /^https?:\/\//i.test(item.url) && <> <a href={item.url} target="_blank" rel="noreferrer">Source</a></>}</p>)}</details>
        </div>
      </article>)}
    </div>
    {!filtered.length && <p className="muted">No contacts match this search.</p>}
    {filtered.length>10 && <div className="button-row"><button type="button" className="button-secondary" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous</button><span>Page {currentPage+1} of {Math.ceil(filtered.length/10)}</span><button type="button" className="button-secondary" disabled={(currentPage+1)*10>=filtered.length} onClick={()=>setPage(currentPage+1)}>Next</button></div>}
  </section>;
}
