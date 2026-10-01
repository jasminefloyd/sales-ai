import {describe,it,expect,vi} from 'vitest';
import {directSearchQuery,normalizeCompanyResults,hunterRequest,normalizeHunterResult,verificationStatus,executeHunter,workerError,discoveryRecordId} from '../functions/_shared/directProviders';

describe('direct provider contracts (executable)',()=>{
  it('builds a nonempty company query from the approved targeting context',()=>{
    const q=directSearchQuery({audience:{name:'Performing arts schools'},icp:{decision_maker:'Program director'},product:{geographic_constraints:'USA'}});
    expect(q).toContain('Performing arts schools'); expect(q).toContain('Program director'); expect(q).toContain('USA');
    expect(()=>directSearchQuery({})).toThrow();
  });
  it('builds an organization enrichment query from an existing account',()=>{
    const q=directSearchQuery({account:{name:'School',domain:'school.test',industry:'education'}});
    expect(q).toContain('school.test');
    expect(q).toContain('School');
  });
  it('normalizes company pages, deduplicates domains, and requires evidence',()=>{
    const results=normalizeCompanyResults({results:[{title:'School',url:'https://www.school.test/about',highlights:['Drama program']},{title:'School faculty',url:'https://school.test/staff',highlights:['Staff']},{title:'Directory',url:'https://linkedin.com/company/school',highlights:['School']},{title:'No evidence',url:'https://other.test'}]});
    expect(results).toHaveLength(1); expect(results[0].domain).toBe('school.test'); expect(results[0].evidence[0].excerpt).toBe('Drama program');
    expect(()=>normalizeCompanyResults({})).toThrow();
  });
  it('maps nested inputs to Hunter fields without leaking application metadata',()=>{
    const result=hunterRequest('findContact',{account:{domain:'school.test'},person:{fullName:'Alex Rivera'},jobId:'internal'},'secret');
    expect(result.endpoint).toBe('email-finder'); expect(result.params.get('full_name')).toBe('Alex Rivera');
    expect(result.params.get('domain')).toBe('school.test'); expect(result.params.has('jobId')).toBe(false);
    expect(()=>hunterRequest('findContact',{},'secret')).toThrow();
  });
  it('uses domain search for named people, not generated contacts',()=>{
    const request = hunterRequest('findPerson',{account:{domain:'school.test'}},'key');
    expect(request.endpoint).toBe('domain-search');
    expect(request.params.get('limit')).toBe('10');
    expect(request.params.get('required_field')).toBe('full_name');
    const people=normalizeHunterResult('findPerson',{data:{emails:[{first_name:'Alex',last_name:'Rivera',position:'Director',value:'alex@school.test',sources:[{uri:'https://school.test/staff',last_seen_on:'2026-09-01'}]},{value:'info@school.test'}]}},{});
    expect(people).toHaveLength(1); expect(people[0]).toMatchObject({fullName:'Alex Rivera',title:'Director'});
  });
  it.each([['valid','valid'],['invalid','invalid'],['accept_all','risky'],['disposable','risky'],['webmail','risky'],['unknown','unknown'],['pending','unknown']])('maps verification %s conservatively', (input,expected)=>expect(verificationStatus(input)).toBe(expected));
  it('retains the real verification timestamp instead of making old data fresh',()=>{
    expect(normalizeHunterResult('verifyContact',{data:{email:'alex@school.test',status:'valid',verification:{date:'2026-09-01'}}},{})).toMatchObject([{verifiedAt:'2026-09-01',verificationStatus:'valid'}]);
  });
  it('does not invent contact results for empty provider data',()=>{
    expect(normalizeHunterResult('findContact',{data:null},{})).toEqual([]);
    expect(()=>normalizeHunterResult('findPerson',{data:{}},{})).toThrow();
  });
  it.each([202,222,429,500])('treats HTTP %s as pending/failure, never verified success',async status=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{}}),{status}));
    await expect(executeHunter('verifyContact',{email:'alex@school.test'},'secret',fetcher)).rejects.toThrow();
  });
  it('executes the real adapter against a mocked HTTP response',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{email:'alex@school.test',status:'valid',verification:{date:'2026-09-01'}}}),{status:200}));
    const result=await executeHunter('verifyContact',{email:'alex@school.test'},'secret',fetcher);
    expect(result[0]).toMatchObject({professionalEmail:'alex@school.test',verificationStatus:'valid'});
  });
  it('preserves PostgREST error details',()=>expect(workerError({code:'42703',message:'Missing column',details:'column details',hint:'check the schema'})).toEqual({code:'42703',message:'Missing column',details:'column details',hint:'check the schema'}));
  it('gives partial discoveries stable IDs without cross-product collisions',async()=>{
    expect(await discoveryRecordId(['p1','a1','person'])).toBe(await discoveryRecordId(['p1','a1','person']));
    expect(await discoveryRecordId(['p1','a1','person'])).not.toBe(await discoveryRecordId(['p2','a1','person']));
  });
});
