<script lang="ts">
  import { formatCalendarDate } from '$lib/format';
  import type { PageData, ActionData } from './$types';
  let { data, form }: {data: PageData; form: ActionData} = $props();
  const days = $derived(data.calendar ? Array.from(new Set([...data.calendar.entries.map(e=>e.date),...data.calendar.availability.map(a=>a.date)])).sort() : []);
</script>
<svelte:head><title>Minsnooks · Calendar</title></svelte:head>
<section class="flow-screen">
  <div class="flow-header"><a class="back-link" href="/fixtures">← Fixtures</a><p class="flow-kicker">LEAGUE TIME · EUROPE/LONDON</p><h1>Calendar</h1>
    <p class="flow-intro">See when the family is free and which dates are in play. A proposal is not an agreed date — or proof of a match.</p></div>
  {#if !data.calendar}
    <div class="placeholder-card"><strong>Members only.</strong> Sign in to see availability and match plans.</div>
  {:else}
    <nav class="cal-nav" aria-label="Calendar months"><a href="/calendar?month={data.calendar.previous}" aria-label="Previous month">←</a><h2>{new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(data.calendar.month+'-01T12:00:00Z'))}</h2><a href="/calendar?month={data.calendar.next}" aria-label="Next month">→</a></nav>
    <div class="cal-key"><span>● Available</span><span>● Unavailable</span><span>◆ Proposed</span><span>✦ Agreed</span></div>
    {#if form?.message}<p role="status" class="cal-notice">{form.message}</p>{/if}
    {#if days.length===0}<div class="placeholder-card">No match plans or marked availability this month. Make the first move.</div>{/if}
    <ol class="cal-days">
      {#each days as day}
        <li class="cal-day"><div class="cal-date"><time datetime={day}>{formatCalendarDate(day,{year:true})}</time>{#if day===data.calendar.today}<span>TODAY</span>{/if}</div>
          {#each data.calendar.entries.filter(e=>e.date===day) as entry}
            <a class="cal-match" href={entry.href}><small>{entry.kind.toUpperCase()} · {entry.state.toUpperCase()}{entry.time ? ` · ${entry.time}` : ''}</small><strong>{entry.label}</strong></a>
          {/each}
          {#if data.calendar.availability.some(a=>a.date===day)}<div class="cal-people">
            {#each data.calendar.availability.filter(a=>a.date===day) as person}<span class:free={person.status==='available'}>{person.name}: {person.status}</span>{/each}
          </div>{/if}
        </li>
      {/each}
    </ol>
    <form method="POST" action="?/availability" class="cal-form flow-card"><h2>Your availability</h2><p>Only signed-in members can see your marked days. You can change or clear a day at any time.</p>
      <label for="cal-input-date">Day</label><input class="flow-input" id="cal-input-date" name="date" type="date" min={data.calendar.today} required />
      <label for="cal-input-status">I am…</label><select class="flow-input" id="cal-input-status" name="status"><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="clear">Clear my mark</option></select><button class="small-primary" type="submit">Save day</button>
    </form>
  {/if}
</section>
<style>
  .cal-nav{display:flex;align-items:center;justify-content:space-between;background:#104b38;border-radius:18px;padding:8px 18px;margin:22px 0;color:#fff}.cal-nav h2{font-size:1.15rem;margin:0}.cal-nav a{font-size:1.5rem;color:#e6d390;padding:4px 10px}.cal-key{display:flex;gap:8px;flex-wrap:wrap;color:#c2dfc8;font-size:.8rem;margin:12px 0}.cal-key span{background:#174c39;border-radius:18px;padding:5px 10px}.cal-days{list-style:none;padding:0;display:grid;gap:10px}.cal-day{border:1px solid #47765b;border-radius:16px;background:linear-gradient(130deg,#134835,#0b3229);padding:14px;color:#f5faee}.cal-date{display:flex;align-items:center;gap:10px;margin-bottom:7px}.cal-date span{font-size:.7rem;color:#e6d390}.cal-match{display:flex;flex-direction:column;gap:3px;border-left:3px solid #f2cb78;padding:8px 12px;background:#205841;margin:6px 0;color:#fff;border-radius:0 8px 8px 0}.cal-match small{color:#e5dc9a;font-size:.72rem;letter-spacing:.06em}.cal-people{display:flex;gap:6px;flex-wrap:wrap}.cal-people span{background:#613e3b;padding:4px 9px;border-radius:12px;font-size:.8rem}.cal-people .free{background:#186b45}.cal-form{display:grid;gap:9px;margin-top:18px}.cal-form h2{margin:0}.cal-form p{margin:0 0 8px}.cal-form button{justify-self:start;margin-top:8px}.cal-notice{color:#e5dc9a}
</style>
