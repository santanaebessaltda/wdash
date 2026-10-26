// @ts-nocheck
/** Motor do gerador de escalas. A busca semanal e o revezamento de domingo seguem o gerador.
 */
  const DAY = 86400000;
  const date = s => new Date(s + 'T12:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);
  const add = (d, n) => new Date(d.getTime() + n * DAY);
  const dow = d => (d.getUTCDay() + 6) % 7;
  const off = v => v === 'F' || v === 'FC';
  const bit = (mask, d) => !!(mask & (1 << d));
  const pop = mask => { let n = 0; for (; mask; mask &= mask - 1) n++; return n; };
  const weekdays = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  function nextMonth(month) { const d=date(month+'-01'); return iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1,12))).slice(0,7); }
  const historyCell=(c,i,day)=>c.previous?.matrix?.[i]?.[c.previous.days?.indexOf(day)];
  const carriedLinks=c=>c.previous?.compensation||[];
  const forcedComp=(c,i,day)=>carriedLinks(c).some(l=>l.employee===i&&l.day===day);
  function validateHistory(c) {
    const p=c.previous;if(!p||p.carryOnly)return;
    const bad=()=>{throw new Error('A escala anterior não corresponde a este mês e à mesma equipe. Abra a cópia do mês anterior e use “Continuar no mês seguinte”.');};
    if(!/^\d{4}-\d{2}$/.test(p.month)||nextMonth(p.month)!==c.month||!['6x1','5x2','4x3','12x36','espanhola'].includes(p.model)||((p.model==='12x36'||c.model==='12x36')&&p.model!==c.model)||!Array.isArray(p.employees)||p.employees.length!==c.employees.length||p.employees.some((e,i)=>e.name!==c.employees[i].name||e.sex!==c.employees[i].sex))bad();
    const last=iso(new Date(Date.UTC(Number(p.month.slice(0,4)),Number(p.month.slice(5)),0,12)));
    if(!Array.isArray(p.days)||p.days.length!==Number(last.slice(8))||p.days[0]!==p.month+'-01'||p.days.at(-1)!==last||p.days.some((d,j)=>j&&d!==iso(add(date(p.days[j-1]),1))))bad();
    if(!Array.isArray(p.matrix)||p.matrix.length!==c.employees.length||!p.matrix.every(row=>Array.isArray(row)&&row.length===p.days.length&&row.every(v=>['T','F','FE','FC'].includes(v))))bad();
    if(![p.open,p.minimum].every(a=>Array.isArray(a)&&a.length===7)||!p.open.every(v=>typeof v==='boolean')||!p.minimum.every(v=>Number.isInteger(v)&&v>=0&&v<=c.employees.length)||!Number.isInteger(p.startWeek)||![1,2].includes(p.firstSpanish)||!['seven','month'].includes(p.compDeadline)||!Array.isArray(p.holidays)||p.holidays.some(h=>!h||!p.days.includes(h.date)||!Number.isInteger(h.workers)||h.workers<0||h.workers>c.employees.length||!['comp','pay'].includes(h.treatment)))bad();
    if(!Array.isArray(p.assignment)||p.assignment.length!==c.employees.length||p.assignment.some(a=>!a||!Number.isInteger(a.base)||a.base<0||a.base>6||(c.model==='12x36'&&![0,1].includes(a.workPhase))))bad();
    if(!Array.isArray(p.compensation)||p.compensation.some(l=>!l||!Number.isInteger(l.employee)||l.employee<0||l.employee>=c.employees.length||!p.holidays.some(h=>h.date===l.holiday&&h.treatment==='comp')||historyCell(c,l.employee,l.holiday)!=='FE'||l.day<=l.holiday||l.deadline!==(p.compDeadline==='seven'?iso(add(date(l.holiday),7)):last)||l.day>l.deadline||(!l.day.startsWith(c.month)&&historyCell(c,l.employee,l.day)!=='FC')))bad();
    if(new Set(p.compensation.map(l=>l.employee+':'+l.day)).size!==p.compensation.length||new Set(p.compensation.map(l=>l.employee+':'+l.holiday)).size!==p.compensation.length)bad();
    if(c.model==='12x36'&&p.compensation.length)bad();
    if(c.model==='espanhola'&&p.model==='espanhola'){c.startWeek=p.startWeek;c.firstSpanish=p.firstSpanish;}
  }
  function weekIndex(d) { return Math.floor((date(iso(d)).getTime() - date('2026-01-05').getTime()) / (7 * DAY)); }
  function business(c, day) {
    if(c.previous&&day<c.month+'-01'&&c.previous.days.includes(day))c={...c.previous,employees:c.employees};
    const h = c.holidays.find(h => h.date === day);
    if (h) return { min: h.workers, max: h.workers, holiday: h, closed: h.workers === 0 };
    const wd = dow(date(day));
    return c.open[wd] ? { min: c.minimum[wd], max: c.employees.length, closed: false } : { min: 0, max: 0, closed: true };
  }
  const holidayTreatment = (c, h) => c.model === '12x36' ? 'exempt' : h.treatment === undefined ? 'comp' : h.treatment;
  function target(c, monday) {
    if (c.model === '5x2') return 2;
    if (c.model === '4x3') return 3;
    if (c.model === 'espanhola') return (Math.abs(weekIndex(monday) - c.startWeek) % 2) ? 3 - c.firstSpanish : c.firstSpanish;
    return 1;
  }
  function validateConfig(input) {
    const c = JSON.parse(JSON.stringify(input));
    if (!/^\d{4}-\d{2}$/.test(c.month) || !Number.isFinite(date(c.month + '-01').getTime()) || iso(date(c.month+'-01')).slice(0,7)!==c.month) throw new Error('Escolha um mês válido.');
    if (!['before', 'after'].includes(c.regime)) throw new Error('Escolha o cenário.');
    if (!['6x1', '5x2', '4x3', '12x36', 'espanhola'].includes(c.model)) throw new Error('Escolha um modelo válido.');
    if (c.regime === 'after' && !['5x2', '4x3', '12x36'].includes(c.model)) throw new Error('Este modelo não atende ao cenário com duas folgas em toda semana.');
    if(c.month>='2026-12'&&['6x1','espanhola'].includes(c.model))throw new Error('Em dezembro de 2026 começa a exigência de duas folgas semanais da EC 141. Este gerador monta o mês inteiro com um único modelo. Escolha “Após o fim da 6×1” e um modelo com duas ou mais folgas para montar esse período.');
    if (!Array.isArray(c.employees) || !c.employees.length || c.employees.length > 60) throw new Error('Cadastre de 1 a 60 funcionários nesta ferramenta.');
    c.employees.forEach(e => {
      if (!e || typeof e.name !== 'string' || !e.name.trim() || e.name.length > 120 || !['M', 'F'].includes(e.sex) || !Number.isInteger(e.fixed) || e.fixed < -1 || e.fixed > 6) throw new Error('Revise os dados e a folga de cada funcionário.');
    });
    if (![c.open, c.minimum].every(a => Array.isArray(a) && a.length === 7)) throw new Error('Defina os sete dias de funcionamento.');
    if (!c.open.every(v => typeof v === 'boolean') || !c.open.some(Boolean)) throw new Error('Marque pelo menos um dia de funcionamento.');
    if (!c.minimum.every(v => Number.isInteger(v) && v >= 0 && v <= c.employees.length)) throw new Error('O mínimo por dia deve estar entre zero e o número de funcionários.');
    if (![c.sundayM, c.sundayF].every(v => Number.isInteger(v) && v >= 0 && v <= 4)) throw new Error('Revise a frequência dos domingos.');
    if(c.model!=='12x36'&&(![0,1,2,3].includes(c.sundayF)||![0,1,2,3].includes(c.sundayM)))throw new Error('Escolha uma frequência válida de domingos.');
    if (!['seven', 'month'].includes(c.compDeadline)) throw new Error('Defina o prazo da folga pelo feriado.');
    // Legacy input may contain false/null. It can no longer consume normal weekly rest.
    c.compAdditional = true;
    if (![1, 2].includes(c.firstSpanish)) c.firstSpanish = 1;
    if (!Array.isArray(c.holidays) || c.holidays.length > 40 || !c.holidays.every(h => h && /^\d{4}-\d{2}-\d{2}$/.test(h.date) && Number.isFinite(date(h.date).getTime()) && iso(date(h.date)) === h.date && h.date.startsWith(c.month) && typeof h.name === 'string' && h.name.length <= 120 && Number.isInteger(h.workers) && h.workers >= 0 && h.workers <= c.employees.length)) throw new Error('Revise as datas e a quantidade de pessoas em cada feriado.');
    if (new Set(c.holidays.map(h => h.date)).size !== c.holidays.length) throw new Error('Existe um feriado repetido. Use uma única configuração por data.');
    c.holidays.forEach(h => {
      if (h.treatment === undefined) h.treatment = 'comp';
      if (!['comp', 'pay'].includes(h.treatment)) throw new Error('Escolha uma folga adicional ou o pagamento em dobro para cada feriado trabalhado.');
    });
    const first = date(c.month + '-01');
    c.startWeek = weekIndex(add(first, -dow(first)));
    validateHistory(c);
    return c;
  }
  function range(c) {
    const first = date(c.month + '-01'), last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12));
    const start = add(first, -dow(first));
    let extraEnd = last;
    for (const h of c.holidays) {
      if (!(h.workers > 0 && holidayTreatment(c, h) === 'comp')) continue;
      const deadline = date(h.deadline || (c.compDeadline === 'seven' ? iso(add(date(h.date), 7)) : iso(last)));
      if (deadline > extraEnd) extraEnd = deadline;
    }
    const end = add(extraEnd, 6 - dow(extraEnd));
    const days = []; for (let d = start; d <= end; d = add(d, 1)) days.push(iso(d));
    return { first: iso(first), last: iso(last), days };
  }
  function sundayOff(c, a, monday, employee) {
    if (a.sundays) return a.sundays.includes(iso(add(monday,6)));
    const cadence=c.employees[employee].sex==='F'?c.sundayF:c.sundayM;
    return cadence&&((weekIndex(monday)-a.phase)%cadence+cadence)%cadence===0;
  }
  function planSundays(c,calendar,assignment,attempt) {
    if(c.model==='12x36')return assignment;
    const sundays=calendar.days.filter(day=>dow(date(day))===6),n=c.employees.length;
    // Leave room for the next rotation, even when the month ends on Sunday.
    // Otherwise everyone can be forced to rest on the very next Sunday.
    const lastSunday=sundays.at(-1);sundays.push(iso(add(date(lastSunday),7)),iso(add(date(lastSunday),14)));
    const limits=sundays.map(day=>business(c,day)),maxOff=limits.map(b=>n-b.min),minOff=limits.map(b=>n-b.max);
    const lists=c.employees.map((e,i)=>{
      const cadence=e.sex==='F'?c.sundayF:c.sundayM,options=[];
      for(let mask=0;mask<(1<<sundays.length);mask++){
        if(limits.some((b,k)=>(b.closed||assignment[i].base===6)&&!bit(mask,k)))continue;
        if(cadence&&sundays.some((_,k)=>k+cadence<=sundays.length&&!Array.from({length:cadence},(_,offset)=>bit(mask,k+offset)).some(Boolean)))continue;
        const priorSundays=cadence>1?(c.previous?.days||[]).filter(day=>dow(date(day))===6&&day<sundays[0]).slice(1-cadence):[];
        const combined=priorSundays.map(day=>historyCell(c,i,day)==='F').concat(sundays.map((_,k)=>bit(mask,k)));
        if(c.previous&&cadence&&combined.some((_,k)=>k+cadence<=combined.length&&!combined.slice(k,k+cadence).some(Boolean)))continue;
        // A one-rest Spanish week ending with Sunday off requires the previous
        // Sunday off too; otherwise the interval contains seven worked days.
        if(c.model==='espanhola'&&sundays.some((day,k)=>k>0&&target(c,add(date(day),-6))===1&&bit(mask,k)&&!bit(mask,k-1)))continue;
        if(c.previous&&c.model==='espanhola'&&target(c,add(date(sundays[0]),-6))===1&&bit(mask,0)&&historyCell(c,i,iso(add(date(sundays[0]),-7)))!=='F')continue;
        if(c.previous&&c.model==='espanhola'){
          const firstWeek=Array.from({length:6},(_,d)=>iso(add(date(sundays[0]),d-6)));
          const pastRest=firstWeek.filter(day=>historyCell(c,i,day)==='F').length;
          const available=firstWeek.filter(day=>!historyCell(c,i,day)&&!forcedComp(c,i,day)).length;
          const required=target(c,add(date(sundays[0]),-6)),sundayRest=bit(mask,0)?1:0;
          if(pastRest+sundayRest>required||pastRest+sundayRest+available<required)continue;
        }
        const preferred=sundays.reduce((m,day,k)=>sundayOff(c,assignment[i],add(date(day),-6),i)?m|(1<<k):m,0);
        options.push({mask,score:pop(mask)*100+pop(mask^preferred)*3+((mask+attempt*(i+1))%(1<<sundays.length))/100});
      }
      return options.sort((a,b)=>a.score-b.score);
    });
    if(lists.some(list=>!list.length))return null;
    const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>lists[a].length-lists[b].length||a-b),counts=Array(sundays.length).fill(0),chosen=Array(n),memo=new Set();let nodes=0;
    function visit(p){
      if(++nodes>45000)return false;
      if(p===n)return counts.every((count,k)=>count>=minOff[k]&&count<=maxOff[k]);
      const key=p+':'+counts.join(',');if(memo.has(key))return false;
      const i=order[p];
      for(const option of lists[i]){
        if(counts.some((count,k)=>count+(bit(option.mask,k)?1:0)>maxOff[k]))continue;
        counts.forEach((_,k)=>{if(bit(option.mask,k))counts[k]++;});
        const possible=counts.every((count,k)=>{let must=count,may=count;for(let q=p+1;q<n;q++){const rest=lists[order[q]];if(rest.every(o=>bit(o.mask,k)))must++;if(rest.some(o=>bit(o.mask,k)))may++;}return must<=maxOff[k]&&may>=minOff[k];});
        chosen[i]=option.mask;if(possible&&visit(p+1))return true;
        counts.forEach((_,k)=>{if(bit(option.mask,k))counts[k]--;});
      }
      memo.add(key);return false;
    }
    return visit(0)?assignment.map((a,i)=>({...a,sundays:sundays.filter((_,k)=>bit(chosen[i],k))})):null;
  }
  // Escolha semanal por busca: fechamento, domingo e folga-base são restrições;
  // o limite de ausências de cada dia vem do mínimo de pessoas presentes.
  function solveWeek(c, days, assignment, previous, counter) {
    const n = c.employees.length, monday = date(days[0]);
    const limits = days.map(d => business(c, d));
    const maxOff = limits.map(b => n - b.min), minOff = limits.map(b => n - b.max);
    const lists = c.employees.map((e, i) => {
      let mandatory = 0;
      limits.forEach((b, d) => { if (b.closed) mandatory |= 1 << d; });
      const cadence = e.sex === 'F' ? c.sundayF : c.sundayM;
      const sundayDue = sundayOff(c,assignment[i],monday,i);
      if (sundayDue) mandatory |= 1 << 6;
      const quota = target(c, monday);
      // Na semana de uma única folga, o domingo de revezamento substitui
      // a base automática; uma base fixada pela pessoa continua obrigatória.
      if (!(c.model === 'espanhola' && quota === 1 && sundayDue && e.fixed < 0)) {
        const base=assignment[i].base;
        if(days[base]>=c.month+'-01'||!c.previous)mandatory |= 1 << base;
      }
      let fixedOff=0,fixedWork=0,extraFC=0;
      days.forEach((day,d)=>{
        const v=historyCell(c,i,day);
        if(v==='F')mandatory|=1<<d;
        if(v==='T'||v==='FE')fixedWork|=1<<d;
        if(v==='FC'||forcedComp(c,i,day)){fixedOff|=1<<d;extraFC|=1<<d;}
      });
      if((mandatory&extraFC)||(mandatory&fixedWork))return [];
      if (c.model === 'espanhola' && pop(mandatory) > quota) return [];
      const rest = Math.max(target(c, monday), pop(mandatory));
      const candidates = [];
      for (let mask = 0; mask < 128; mask++) {
        if ((mask & mandatory) !== mandatory || (mask&fixedOff)!==fixedOff || (mask&fixedWork) || pop(mask)-pop(extraFC) < rest) continue;
        const holidayOff=limits.reduce((m,b,d)=>b.holiday?m|(1<<d):m,0);
        // An exact holiday headcount may free additional people that day.
        // These days off must not be rejected as excess monthly/weekly quota in 5x2.
        if(c.model==='espanhola'?pop(mask)-pop(extraFC)!==rest:pop(mask)-pop(extraFC)-rest>pop(mask&holidayOff&~mandatory&~extraFC))continue;
        // Fora do domingo de revezamento, conserva o trabalho dominical;
        // fechamento e domingo fixo prevalecem sobre essa preferência.
        if (c.model !== 'espanhola' && cadence && !sundayDue && !limits[6].holiday && !bit(mandatory, 6) && bit(mask, 6)) continue;
        let run = 0, invalid = false;
        const tail = previous[i] || [];
        tail.concat(days.map((_, d) => bit(mask, d) ? 'F' : 'T')).forEach(v => { run = off(v) ? 0 : run + 1; if (run > 6) invalid = true; });
        if (invalid) continue;
        // Antecipação da próxima semana evita fechar a atual com uma sequência
        // que não poderia terminar antes de sete dias seguidos de trabalho.
        if (c.model === 'espanhola') {
          const nextMonday = add(monday, 7), nextDue = sundayOff(c,assignment[i],nextMonday,i);
          let nextMandatory = 0;
          for (let d = 0; d < 7; d++) if (business(c, iso(add(nextMonday, d))).closed) nextMandatory |= 1 << d;
          if (nextDue) nextMandatory |= 1 << 6;
          if (!(target(c, nextMonday) === 1 && nextDue && e.fixed < 0)) nextMandatory |= 1 << assignment[i].base;
          if (pop(nextMandatory) >= target(c, nextMonday)) {
            const firstOff = Array.from({ length: 7 }, (_, d) => d).find(d => bit(nextMandatory, d));
            let tailRun = 0; for (let d = 6; d >= 0 && !bit(mask, d); d--) tailRun++;
            if (tailRun + firstOff > 6) continue;
          }
        }
        const flex = Array.from({ length: 7 }, (_, d) => d).filter(d => bit(mask, d) && !bit(mandatory, d));
        const desired = ((i + Math.abs(weekIndex(monday))) % 6);
        const score = (pop(mask)-pop(extraFC)-rest)*1000 + flex.reduce((a, d) => a + Math.abs(d - desired), 0) + (bit(mask, 6) && !bit(mandatory, 6) ? 10000 : 0);
        candidates.push({ mask, score });
      }
      return candidates.sort((a, b) => a.score - b.score || a.mask - b.mask);
    });
    if (lists.some(a => !a.length)) return null;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => lists[a].length - lists[b].length || a - b);
    const counts = Array(7).fill(0), result = Array(n);
    function visit(pos) {
      if (++counter.nodes > counter.limit) { counter.exhausted = true; return false; }
      if (pos === n) return counts.every((count, d) => count >= minOff[d] && count <= maxOff[d]);
      const i = order[pos];
      for (const candidate of lists[i]) {
        if (counts.some((count, d) => count + (bit(candidate.mask, d) ? 1 : 0) > maxOff[d])) continue;
        for (let d = 0; d < 7; d++) if (bit(candidate.mask, d)) counts[d]++;
        let possible = true;
        for (let d = 0; d < 7 && possible; d++) {
          let must = counts[d], may = counts[d];
          for (let p = pos + 1; p < n; p++) {
            const options = lists[order[p]];
            if (options.every(o => bit(o.mask, d))) must++;
            if (options.some(o => bit(o.mask, d))) may++;
          }
          if (must > maxOff[d] || may < minOff[d]) possible = false;
        }
        result[i] = candidate.mask;
        if (possible && visit(pos + 1)) return true;
        for (let d = 0; d < 7; d++) if (bit(candidate.mask, d)) counts[d]--;
        if (counter.exhausted) return false;
      }
      return false;
    }
    return visit(0) ? result : null;
  }
  function assign(c, attempt, calendar) {
    const loads=Array(7).fill(0),sundayLoads=new Map();
    c.employees.forEach(e=>{if(e.fixed>=0)loads[e.fixed]++;});
    const capacity=Array.from({length:7},(_,d)=>c.employees.length-Math.max(0,...calendar.days.filter(day=>dow(date(day))===d).map(day=>business(c,day).min)));
    return c.employees.map((e,i)=>{
      let base=e.fixed;
      if(base<0){
        let choices=Array.from({length:6},(_,d)=>d).filter(d=>loads[d]<capacity[d]);
        // A weekly base cannot fall on a day that needs the entire team.
        // Prefer a shared closure when it already supplies all normal rest days.
        if(!c.open[6]&&(['6x1','espanhola'].includes(c.model)||!choices.length)&&loads[6]<capacity[6])choices.push(6);
        if(!choices.length)choices=Array.from({length:7},(_,d)=>d);
        choices.sort((a,b)=>{
          const sa=(c.open[a]?1:0)*1000+(loads[a]/Math.max(1,capacity[a]))*100;
          const sb=(c.open[b]?1:0)*1000+(loads[b]/Math.max(1,capacity[b]))*100;
          return sa-sb||((a+attempt)%7)-((b+attempt)%7);
        });
        base=choices[0];loads[base]++;
      }
      const cadence=e.sex==='F'?c.sundayF:c.sundayM;
      const phases=Array.from({length:cadence||1},(_,p)=>p);
      phases.sort((a,b)=>(sundayLoads.get(cadence+':'+a)||0)-(sundayLoads.get(cadence+':'+b)||0)||((a+attempt+i)%phases.length)-((b+attempt+i)%phases.length));
      const phase=phases[0];sundayLoads.set(cadence+':'+phase,(sundayLoads.get(cadence+':'+phase)||0)+1);
      return{base,phase};
    });
  }
  const formatDay = day => day.split('-').reverse().join('/');
  const quantity = (n,one,many=one+'s') => n+' '+(n===1?one:many);
  const action = (label, target) => ({label, target});
  function diagnose(c, calendar) {
    const n = c.employees.length;
    const staffing = [action('Rever pessoas por dia', 'businessDays'), action('Adicionar pessoas à equipe', 'employeeName')];
    for(const day of calendar.days.filter(d=>d>=c.month+'-01')){
      const committed=carriedLinks(c).filter(l=>l.day===day),b=business(c,day);
      if(committed.length&&(b.closed||b.holiday||n-committed.length<b.min))return[{title:'Já existe folga pelo feriado marcada para '+formatDay(day),explanation:committed.map(l=>c.employees[l.employee].name).join(', ')+' recebeu essa folga na escala anterior. A configuração deste mês não deixa mantê-la como folga adicional em um dia de trabalho.',details:['Para mudar a data, abra a cópia da escala anterior, marque “Ver também os dias dos meses vizinhos”, ajuste a compensatória e continue para este mês novamente.','Se o conflito for apenas a quantidade de pessoas, reveja o mínimo necessário nesse dia.'],actions:[action('Rever pessoas por dia','businessDays'),action('Rever feriados','holidayList')]}];
    }
    if (c.model === '12x36') {
      let lower = 0, upper = n, lowerDay = '', upperDay = '';
      for (const day of calendar.days) {
        const b = business(c, day); if (b.closed) continue;
        const parity = Math.abs(Math.floor((date(day) - date('2026-01-01')) / DAY) % 2);
        const lo = parity ? n - b.max : b.min, hi = parity ? n - b.min : b.max;
        if (lo > lower) { lower = lo; lowerDay = day; }
        if (hi < upper) { upper = hi; upperDay = day; }
      }
      if (lower > upper) return [{title:'A quantidade de pessoas não cabe no dia sim, dia não', explanation:'Na 12×36, quem trabalha em um dia folga no seguinte. As quantidades pedidas em '+formatDay(lowerDay || upperDay)+' e '+formatDay(upperDay || lowerDay)+' exigem grupos que não cabem na equipe de '+n+' pessoa(s).', details:['Confira também os feriados: a quantidade escolhida para eles é exata.'], actions:[...staffing,action('Rever os feriados','holidayList')]}];
      return [];
    }
    for (const day of calendar.days) {
      if(c.previous&&day<c.month+'-01')continue;
      const wd = dow(date(day)), b = business(c, day);
      if (!b.min) continue;
      const unavailable = c.employees.filter(e => e.fixed === wd || (wd === 6 && (e.sex === 'F' ? c.sundayF : c.sundayM) === 1));
      if (n - unavailable.length < b.min) return [{title:'Falta gente em '+weekdays[wd]+', '+formatDay(day), explanation:'Você pediu '+b.min+' pessoa(s) trabalhando, mas só '+(n-unavailable.length)+' pode(m) trabalhar com as folgas que escolheu.',details:['Folga marcada para: '+unavailable.map(e=>e.name).join(', ')+'.'],actions:[action('Rever os dias de folga','employeeList'),b.holiday?action('Rever este feriado','holidayList'):action('Rever pessoas por dia','businessDays')]}];
    }
    for(let wi=0;wi<calendar.days.length;wi+=7){
      if(c.previous&&calendar.days[wi]<c.month+'-01')continue;
      const days=calendar.days.slice(wi,wi+7), required=target(c,date(days[0])), demand=days.reduce((sum,day)=>sum+business(c,day).min,0);
      const capacity=c.employees.reduce((sum,e)=>sum+Math.min(7-required,days.filter(day=>{const wd=dow(date(day));return !business(c,day).closed&&e.fixed!==wd&&!(wd===6&&(e.sex==='F'?c.sundayF:c.sundayM)===1);}).length),0);
      if(demand>capacity)return[{title:'Falta gente para cobrir a semana de '+formatDay(days[0])+' a '+formatDay(days[6]),explanation:n===1?'A empresa precisa de alguém trabalhando em '+quantity(demand,'dia')+' desta semana. '+c.employees[0].name+' precisa de '+quantity(required,'folga')+' e pode trabalhar em no máximo '+quantity(capacity,'dia')+'.':'Você cadastrou '+quantity(n,'pessoa')+'. Somando as pessoas pedidas em cada dia, são '+demand+' dias de trabalho para distribuir. Com '+quantity(required,'folga')+' por pessoa nessa semana, a equipe consegue cobrir no máximo '+capacity+'.',details:[(demand-capacity===1?'Falta cobrir 1 dia de trabalho.':'Faltam cobrir '+(demand-capacity)+' dias de trabalho de uma pessoa.')+(n===1?'':' Exemplo: 2 pessoas trabalhando por 3 dias cobrem 6 dias de trabalho.'),'Você pode incluir mais pessoas ou diminuir a quantidade pedida nos dias em que a empresa consegue funcionar com uma equipe menor.'],actions:staffing}];
    }
    const sundays=calendar.days.filter(day=>dow(date(day))===6);
    const demand=sundays.reduce((sum,day)=>sum+business(c,day).min,0);
    const capacity=c.employees.reduce((sum,e)=>{const cadence=e.sex==='F'?c.sundayF:c.sundayM;return sum+(e.fixed===6?0:sundays.length-(cadence?Math.floor(sundays.length/cadence):0));},0);
    if(demand>capacity)return[{title:'O revezamento dos domingos precisa de mais pessoas',explanation:'A quantidade pedida nos domingos não deixa espaço para todas as folgas de domingo escolhidas para a equipe.',details:['Foram pedidas '+demand+' presenças nos '+sundays.length+' domingos conferidos, incluindo as semanas completas que atravessam o mês. A equipe pode cobrir no máximo '+capacity+' com esse revezamento.'],actions:staffing}];
    const endHolidays=c.holidays.filter(h=>h.workers>0&&holidayTreatment(c,h)==='comp'&&h.date===calendar.last&&c.compDeadline==='month');
    if(endHolidays.length)return[{title:'Não sobra um dia para a folga pelo feriado',explanation:'Há '+endHolidays[0].workers+' pessoa(s) trabalhando no feriado de '+formatDay(calendar.last)+', que é o último dia do mês. Você escolheu dar a folga depois do feriado e ainda dentro desse mês.',details:['Escolha o prazo de 7 dias seguintes para permitir a folga no mês seguinte, ou reveja o funcionamento nesse feriado. Se a empresa optar pelo pagamento em dobro, marque essa opção no feriado.'],actions:[action('Mudar o prazo da folga','compDeadline'),action('Rever o feriado','holidayList')]}];
    return [];
  }
  function compensation(c, calendar, matrix) {
    if(c.model==='12x36')return {links:[]};
    const jobs=[];
    for(const h of c.holidays.filter(h=>holidayTreatment(c,h)==='comp').sort((a,b)=>a.date.localeCompare(b.date))){
      const hi=calendar.days.indexOf(h.date),deadline=h.deadline||(c.compDeadline==='seven'?iso(add(date(h.date),7)):calendar.last);
      c.employees.forEach((e,i)=>{if(matrix[i][hi]==='FE')jobs.push({employee:i,holiday:h.date,deadline,hi,notBefore:h.notBefore||iso(add(date(h.date),1))});});
    }
    if(!jobs.length)return{links:[]};
    // One unit per worked holiday; one rest per employee/date; shared daily staffing capacity.
    const graph=[[],[]], source=0,sink=1,dayNodes=new Map(),personDays=new Map();
    const node=()=>{graph.push([]);return graph.length-1;};
    const edge=(from,to,cap)=>{const forward={to,cap,rev:graph[to].length};graph[from].push(forward);graph[to].push({to:from,cap:0,rev:graph[from].length-1});return forward;};
    const capacities=calendar.days.map((day,j)=>{const b=business(c,day);return matrix.reduce((n,row)=>n+(!off(row[j])?1:0),0)-b.min;});
    for(const job of jobs){
      job.node=node();edge(source,job.node,1);job.options=[];
      for(let j=job.hi+1;j<calendar.days.length&&calendar.days[j]<=job.deadline;j++){
        const day=calendar.days[j],b=business(c,day),i=job.employee;
        if(day<job.notBefore||b.closed||b.holiday||capacities[j]<=0||matrix[i][j]!=='T')continue;
        if(!dayNodes.has(j)){const dn=node();dayNodes.set(j,dn);edge(dn,sink,capacities[j]);}
        const key=i+':'+j;
        if(!personDays.has(key)){const pn=node();personDays.set(key,pn);edge(pn,dayNodes.get(j),1);}
        job.options.push({j,edge:edge(job.node,personDays.get(key),1)});
      }
    }
    let flow=0;
    while(true){
      const level=Array(graph.length).fill(-1),queue=[source];level[source]=0;
      for(let q=0;q<queue.length;q++)for(const e of graph[queue[q]])if(e.cap>0&&level[e.to]<0){level[e.to]=level[queue[q]]+1;queue.push(e.to);}
      if(level[sink]<0)break;
      const pos=Array(graph.length).fill(0);
      function send(v){if(v===sink)return true;for(;pos[v]<graph[v].length;pos[v]++){const e=graph[v][pos[v]];if(e.cap>0&&level[e.to]===level[v]+1&&send(e.to)){e.cap--;graph[e.to][e.rev].cap++;return true;}}return false;}
      while(send(source))flow++;
    }
    if(flow!==jobs.length){
      const job=jobs.find(j=>!j.options.some(o=>o.edge.cap===0));
      const message='A folga de '+c.employees[job.employee].name+' pelo feriado de '+formatDay(job.holiday)+' ainda não coube entre '+formatDay(iso(add(date(job.holiday),1)))+' e '+formatDay(job.deadline)+'.';
      return{error:message,diagnostics:[{title:'Falta espaço para a folga pelo feriado',explanation:message,details:['Nesta distribuição, os dias disponíveis não comportam todas as folgas adicionais sem faltar gente para trabalhar. As folgas normais da semana são preservadas.','Tente um prazo que inclua mais dias, reveja quantas pessoas precisam trabalhar ou inclua mais pessoas na equipe.'],actions:[action('Rever prazo da folga','compDeadline'),action('Rever pessoas por dia','businessDays'),action('Rever os feriados','holidayList')]}]};
    }
    const links=jobs.map(job=>{const j=job.options.find(o=>o.edge.cap===0).j;matrix[job.employee][j]='FC';return{employee:job.employee,holiday:job.holiday,day:calendar.days[j],deadline:job.deadline};});
    return{links};
  }
  function generate(input) {
    let c;
    try { c = validateConfig(input); } catch (e) { return { ok: false, error: e.message }; }
    const calendar = range(c), n = c.employees.length;
    const diagnostics = diagnose(c, calendar);
    if(diagnostics.length)return{ok:false,error:diagnostics[0].explanation,diagnostics};
    // Não apresenta uma busca limitada como prova matemática de inviabilidade.
    let lastError = '', lastDiagnostics = [], exhausted = false;
    for (let attempt = 0; attempt < 24; attempt++) {
      const assignment = planSundays(c,calendar,assign(c,attempt,calendar),attempt), matrix = Array.from({ length: n }, () => []);
      if(!assignment){lastError='Não foi possível distribuir os domingos de folga mantendo a quantidade de pessoas pedida. Reveja a equipe, as folgas fixas e o mínimo nos domingos.';lastDiagnostics=[{title:'O revezamento de domingos precisa de ajuste',explanation:lastError,actions:[action('Rever pessoas por dia','businessDays'),action('Rever as folgas fixas','employeeList')]}];continue;}
      let failed = false;
      if (c.model === '12x36') {
        // Dois grupos alternados, com fase estável entre meses.
        const parity = Math.floor((date(calendar.days[0]) - date('2026-01-01')) / DAY);
        let lower=0,upper=n;
        calendar.days.forEach(day=>{const b=business(c,day);if(b.closed)return;const p=Math.abs(Math.floor((date(day)-date('2026-01-01'))/DAY)%2);lower=Math.max(lower,p?n-b.max:b.min);upper=Math.min(upper,p?n-b.min:b.max);});
        const groupSize=Math.max(lower,Math.min(upper,Math.ceil(n/2)));
        const phases=Array.from({length:n},(_,i)=>c.previous?c.previous.assignment[i].workPhase:((i+attempt)%n)<groupSize?0:1);
        phases.forEach((phase, i) => { assignment[i].workPhase = phase; });
        calendar.days.forEach((day, j) => matrix.forEach((row, i) => {
          const b = business(c, day);
          row.push(historyCell(c,i,day)||(b.closed || (parity + j + phases[i]) % 2 !== 0 ? 'F' : b.holiday ? 'FE' : 'T'));
        }));
      } else {
        const counter = { nodes: 0, limit: 45000, exhausted: false };
        for (let wi = 0; wi < calendar.days.length; wi += 7) {
          const days = calendar.days.slice(wi, wi + 7);
          const tails=matrix.map((row,i)=>(c.previous?c.previous.days.map((d,j)=>({d,v:c.previous.matrix[i][j]})).filter(x=>x.d<calendar.days[0]).map(x=>x.v):[]).concat(row).slice(-6));
          const masks = solveWeek(c, days, assignment, tails, counter);
          if (!masks) { failed = true; exhausted ||= counter.exhausted; lastError = 'A distribuição automática ainda não conseguiu fechar a semana de ' + formatDay(days[0]) + ' a ' + formatDay(days[6]) + ' com todas as escolhas feitas.'; lastDiagnostics=[{title:'Vamos ajustar essa semana',explanation:lastError,details:['Isso não confirma que a escala seja impossível. Suas respostas estão salvas para você ajustar e tentar novamente.'],actions:[action('Rever pessoas por dia','businessDays'),action('Rever os dias de folga','employeeList'),action('Rever os feriados','holidayList')]}]; break; }
          masks.forEach((mask, i) => days.forEach((day, d) => matrix[i].push(historyCell(c,i,day)||(forcedComp(c,i,day)?'FC':bit(mask, d) ? 'F' : business(c, day).holiday ? 'FE' : 'T'))));
        }
      }
      if (failed) continue;
      const comp = compensation(c, calendar, matrix);
      if (comp.error) { lastError = comp.error; lastDiagnostics=comp.diagnostics; continue; }
      const result = { ok: true, config: c, ...calendar, matrix, assignment, compensation: carriedLinks(c).filter(l=>calendar.days.includes(l.day)).concat(comp.links) };
      result.evaluation = evaluate(result);
      if (result.evaluation.errors.length) { lastError = result.evaluation.errors[0]; continue; }
      return result;
    }
    return { ok: false, error: lastError || 'Não foi possível conciliar a alternância da 12×36 com as quantidades de pessoas por dia e feriado.', searchLimited: exhausted, diagnostics:lastDiagnostics };
  }
  function evaluate(r) {
    const c = r.config, errors = [], warnings = [], weekly = [], present = [], issues = [], payroll = [], sundayRisk = [];
    const fail = (s, kind = 'geral') => { if (!errors.includes(s)) { errors.push(s); issues.push({kind, message:s}); } };
    if(c.model!=='12x36'&&(![0,1,2,3].includes(c.sundayF)||![0,1,2,3].includes(c.sundayM)))fail('A frequência de domingos escolhida não é válida para este cenário.','domingos');
    r.days.forEach((day, j) => {
      const b = business(c, day), count = r.matrix.reduce((n, row) => n + (!off(row[j]) ? 1 : 0), 0);
      present.push(count);
      if (count < b.min) fail(day + ': ' + count + ' presentes; mínimo ' + b.min + '.', b.holiday ? 'feriados' : 'presenca');
      if (count > b.max) fail(day + ': ' + count + ' presentes; quantidade definida ' + b.max + '.', b.closed ? 'fechamento' : b.holiday ? 'feriados' : 'presenca');
      if (b.closed && count) fail(day + ': existe trabalho em um dia fechado.', 'fechamento');
    });
    c.employees.forEach((e, i) => {
      const row = r.matrix[i]; let run = 0;
      if(c.previous)c.previous.days.forEach((day,j)=>{if(day<r.days[0])run=off(c.previous.matrix[i][j])?0:run+1;});
      row.forEach((v, j) => {
        if (!['T', 'F', 'FE', 'FC'].includes(v)) fail(e.name + ': célula inválida em ' + r.days[j] + '.', 'geral');
        if (v === 'FE' && !business(c, r.days[j]).holiday) fail(e.name + ': dia ' + r.days[j] + ' não foi cadastrado como feriado.', 'feriados');
        const historical=historyCell(c,i,r.days[j]);
        if(historical&&historical!==v)fail(e.name+': o dia '+r.days[j]+' foi alterado em relação à escala anterior.','continuidade');
        if(forcedComp(c,i,r.days[j])&&v!=='FC')fail(e.name+': a compensatória já marcada para '+r.days[j]+' precisa ser preservada.','continuidade');
        run = off(v) ? 0 : run + 1;
        if (c.model !== '12x36' && run > 6) fail(e.name + ': mais de seis dias seguidos de trabalho até ' + r.days[j] + '.', 'consecutivos');
      });
      for (let wi = 0; wi < r.days.length; wi += 7) {
        const slice = row.slice(wi, wi + 7), rest = slice.filter(off).length;
        const extraFC = slice.filter(v => v === 'FC').length;
        const required = c.model === '12x36' ? (c.regime === 'after' ? 2 : 0) : target(c, date(r.days[wi]));
        weekly.push({ employee: i, start: r.days[wi], end: r.days[wi + 6], rest, required, extraFC });
        if (rest - extraFC < required) fail(e.name + ': semana ' + r.days[wi] + ' a ' + r.days[wi + 6] + ' com ' + rest + ' folga(s); exigidas ' + required + (extraFC ? ' mais ' + extraFC + ' compensatória(s).' : '.'), 'semanas');
        if((c.regime==='after'||r.days[wi]>='2026-12-16')&&rest-extraFC<2)fail(e.name+': faltam duas folgas normais na semana de '+r.days[wi]+'. A compensatória de feriado é adicional.','nova_lei');
        if (c.model === 'espanhola' && rest - extraFC > required) fail(e.name + ': semana ' + r.days[wi] + ' tem mais folgas que a alternância de uma e duas definida para a espanhola.', 'semanas');
      }
      if (c.model === '12x36') {
        if(row.includes('FC')||r.compensation.some(link=>link.employee===i))fail(e.name+': a 12×36 já considera os feriados compensados e não recebe folga adicional por feriado.','compensacao');
        for (let j = 1; j < row.length; j++) if (!off(row[j]) && !off(row[j - 1])) fail(e.name + ': a 12×36 tem trabalho em dois dias seguidos.', 'alternancia');
        row.forEach((v, j) => {
          const parity = Math.floor((date(r.days[j]) - date('2026-01-01')) / DAY);
          const shouldWork = !business(c, r.days[j]).closed && (parity + r.assignment[i].workPhase) % 2 === 0;
          if (shouldWork === off(v)) fail(e.name + ': alternância dia sim, dia não alterada em ' + r.days[j] + '.', 'alternancia');
        });
      } else {
        const cadence = e.sex === 'F' ? c.sundayF : c.sundayM;
        r.days.forEach((day, j) => {
          const wd = dow(date(day));
          const monday = add(date(day), -wd);
          const sundayDue = sundayOff(c,r.assignment[i],monday,i);
          const replacesBase = c.model === 'espanhola' && target(c, monday) === 1 && sundayDue && e.fixed < 0;
          if ((!c.previous||day>=r.first)&&wd === r.assignment[i].base && !replacesBase && row[j] !== 'F') fail(e.name + ': folga-base de ' + weekdays[wd] + ' não respeitada em ' + day + '.', 'base');
          if (wd === 6 && sundayDue && row[j] !== 'F') fail(e.name + ': domingo de folga não respeitado em ' + day + '.', 'domingos');
        });
        const sundays=r.days.map((day,j)=>({day,j})).filter(x=>dow(date(x.day))===6);
        if(cadence)for(let k=0;k+cadence<=sundays.length;k++)if(sundays.slice(k,k+cadence).every(x=>row[x.j]!=='F'))fail(e.name+': falta um domingo de folga no período de '+sundays[k].day+' a '+sundays[k+cadence-1].day+'.','domingos');
        const actualSundays=(c.previous?.days||[]).filter(day=>dow(date(day))===6&&day<r.days[0]).map(day=>({day,value:historyCell(c,i,day)})).concat(sundays.map(x=>({day:x.day,value:row[x.j]})));
        if(cadence)for(let k=0;k+cadence<=actualSundays.length;k++)if(actualSundays[k+cadence-1].day>=r.first&&actualSundays.slice(k,k+cadence).every(x=>x.value!=='F'))fail(e.name+': falta domingo de folga na passagem de '+actualSundays[k].day+' a '+actualSundays[k+cadence-1].day+'.','continuidade');
        if(c.regime==='after'&&c.sundayF===3&&e.sex==='F')for(let k=1;k<actualSundays.length;k++)if(actualSundays[k].day>=r.first&&actualSundays[k].day<=r.last&&!off(actualSundays[k-1].value)&&!off(actualSundays[k].value)){sundayRisk.push({employee:i,first:actualSundays[k-1].day,second:actualSundays[k].day});break;}
      }
    });
    if (c.model !== '12x36') {
      c.holidays.forEach(h => {
        const j = r.days.indexOf(h.date);
        c.employees.forEach((e, i) => {
          if (j < 0 || !['T','FE'].includes(r.matrix[i][j])) return;
          if (holidayTreatment(c,h) === 'pay') payroll.push({employee:i, holiday:h.date, name:h.name});
          else if (!r.compensation.some(link => link.employee === i && link.holiday === h.date)) fail(e.name + ': feriado trabalhado em ' + h.date + ' sem compensatória vinculada.', 'compensacao');
        });
      });
      r.compensation.forEach(link => {
        const j = r.days.indexOf(link.day), h = r.days.indexOf(link.holiday);
        const carried=carriedLinks(c).find(l=>l.employee===link.employee&&l.holiday===link.holiday);
        const holiday = c.holidays.find(item=>item.date===link.holiday)||c.previous?.holidays.find(item=>item.date===link.holiday);
        if (!holiday || holidayTreatment(c,holiday) !== 'comp') fail(c.employees[link.employee].name + ': esta folga está vinculada a um feriado escolhido para pagamento em dobro. Reveja a folga adicional.', 'compensacao');
        const deadline = carried?carried.deadline:(holiday?.deadline||(c.compDeadline === 'seven' ? iso(add(date(link.holiday), 7)) : r.last));
        if(j>=0&&(business(c,link.day).closed||business(c,link.day).holiday))fail(c.employees[link.employee].name+': a folga adicional pelo feriado precisa ocupar um dia de trabalho, preservando os feriados e dias de fechamento.','compensacao');
        const worked=h>=0?r.matrix[link.employee][h]:historyCell(c,link.employee,link.holiday);
        if (j < 0 || r.matrix[link.employee][j] !== 'FC' || worked !== 'FE' || link.day <= link.holiday || link.day > deadline || link.deadline !== deadline || (carried&&link.day!==carried.day)) fail(c.employees[link.employee].name + ': vínculo de compensatória alterado ou fora do prazo.', 'compensacao');
      });
      const links = r.compensation.map(link => link.employee + ':' + link.day);
      if (new Set(links).size !== links.length) fail('Uma compensatória foi usada para mais de um feriado.', 'compensacao');
      const holidays = r.compensation.map(link => link.employee + ':' + link.holiday);
      if (new Set(holidays).size !== holidays.length) fail('Um mesmo feriado recebeu mais de uma compensatória para a mesma pessoa.', 'compensacao');
      r.matrix.forEach((row, i) => row.forEach((v, j) => { if (v === 'FC' && !r.compensation.some(l => l.employee === i && l.day === r.days[j])) fail(c.employees[i].name + ': compensatória sem feriado vinculado em ' + r.days[j] + '.', 'compensacao'); }));
    }
    if(!c.previous)warnings.push('Mês anterior não informado: os dias fora deste mês são uma projeção. Para conferir a virada do mês, abra a escala anterior e use “Continuar no mês seguinte”.');
    warnings.push('Antes de usar: confira os horários e intervalos de cada pessoa. Esta ferramenta confere dias e folgas; não recebe os horários nem comprova a carga horária ou o pagamento.');
    warnings.push('EC 141/2026: duas folgas semanais e limite de 42 horas após dois meses da publicação de 16/10/2026; limite de 40 horas um ano depois. Confira também a convenção coletiva da categoria.');
    if(sundayRisk.length)warnings.push('Atenção aos domingos das funcionárias: esta escala inclui dois domingos seguidos de trabalho. O art. 386 da CLT prevê revezamento quinzenal. A opção de um domingo de folga a cada três é juridicamente controversa para mulheres; confira a regra da categoria e obtenha orientação jurídica antes de aplicar.');
    if(c.model==='12x36')warnings.push('Na 12×36, a alternância de dias não comprova os limites de horas da EC 141. Confira a jornada efetiva e o instrumento que autoriza esse regime antes de usar.');
    if(c.model==='espanhola')warnings.push('A espanhola exige conferência da autorização em acordo ou convenção coletiva. A alternância de uma e duas folgas não atende à nova regra ordinária de duas folgas por semana.');
    if (r.compensation.some(link => !link.day.startsWith(c.month))) warnings.push('Há compensatórias no mês seguinte. Elas estão listadas e incluídas na avaliação.');
    payroll.sort((a,b)=>a.holiday.localeCompare(b.holiday)||a.employee-b.employee);
    const workedHoliday = c.holidays.some(h => holidayTreatment(c,h)==='comp' && r.matrix.some(row => !off(row[r.days.indexOf(h.date)])));
    const definitions = [
      ['semanas','Folgas por semana · segunda a domingo',true],
      ['nova_lei','Duas folgas normais na semana · EC 141/2026',c.regime==='after'||r.days.some(day=>day>='2026-12-16')],
      ['continuidade','Continuidade com a escala anterior',!!c.previous],
      ['presenca','Mínimo de pessoas nos dias abertos',r.days.some(day=>{const b=business(c,day);return !b.closed&&!b.holiday;})],
      ['fechamento','Dias em que a empresa fecha',r.days.some(day=>business(c,day).closed)],
      ['domingos','Domingos de folga',c.model!=='12x36'&&(c.sundayM>0||c.sundayF>0)],
      ['base','Dia de folga escolhido para cada pessoa',c.model!=='12x36'],
      ['consecutivos','Máximo de seis dias consecutivos',c.model!=='12x36'],
      ['alternancia','Alternância dia sim, dia não',c.model==='12x36'],
      ['feriados','Quantidade de pessoas nos feriados',c.holidays.length>0],
      ['compensacao','Folgas pelos feriados e seus prazos',c.model!=='12x36'&&(workedHoliday||r.compensation.length>0)],
      ['geral','Preenchimento da escala',true]
    ];
    const checks=definitions.map(([id,label,applicable])=>{const details=issues.filter(issue=>issue.kind===id).map(issue=>issue.message);return{id,label,status:details.length?'error':id==='domingos'&&sundayRisk.length?'attention':applicable?'ok':'na',details};});
    return { errors, warnings, weekly, present, checks, payroll, sundayRisk, status: errors.length ? 'Revisar escala' : sundayRisk.length ? 'Escala montada — atenção aos domingos das funcionárias' : payroll.length ? 'Escala montada — atenção à folha de pagamento' : 'Critérios da escala atendidos' };
  }
export { generate };
