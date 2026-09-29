<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  let { data }: {data: PageData} = $props();
  let status = $state('');
  let supported = $state(false);
  onMount(() => { supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext; });
  function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
    const raw=atob(base64.replace(/-/g,'+').replace(/_/g,'/'));
    return Uint8Array.from(raw,c=>c.charCodeAt(0));
  }
  async function enable() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {status='Permission not granted. In-app notifications still work.';return;}
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:keyBytes(data.publicKey)});
      const response=await fetch('/notifications/subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});
      if (!response.ok) {await sub.unsubscribe();throw new Error('Could not save this subscription.');}
      status='Push enabled on this device.';
    } catch {status='Could not enable push on this device. In-app notifications still work.';}
  }
  async function disable() {
    try {
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.getSubscription();
      if (sub) {
        const response=await fetch('/notifications/subscription',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});
        if (!response.ok) throw new Error('Could not remove subscription');
        await sub.unsubscribe();
      }
      status='Push disabled on this device.';
    } catch {status='Could not disable push. Please try again.';}
  }
</script>
<svelte:head><title>Minsnooks · Notifications</title></svelte:head>
<section class="flow-screen">
  <div class="flow-header"><a class="back-link" href="/">← Home</a><p class="flow-kicker">YOUR CUE</p><h1>Notifications</h1><p class="flow-intro">Match updates, draws and direct messages. League-channel chat stays quiet.</p></div>
  {#if !data.signedIn}<div class="placeholder-card">Sign in to see your notifications.</div>
  {:else}
    <div class="flow-card notice-settings"><h2>On this device</h2><p>Push is optional. Alerts never include a message body. You can still use the inbox without permission.</p>
      {#if supported && data.publicKey}<div class="notice-actions"><button class="small-primary" onclick={enable}>Enable push</button><button class="small-secondary" onclick={disable}>Turn off push</button></div>
      {:else}<p>Push is not available here; your in-app inbox still works.</p>{/if}
      {#if status}<p role="status">{status}</p>{/if}</div>
    {#if !data.items.length}<div class="placeholder-card">All quiet on the baize. No updates yet.</div>{/if}
    <ol class="notice-list">{#each data.items as item}<li class:unread={!item.read_at}>
      <form method="POST" action="?/open"><input type="hidden" name="id" value={item.id}/><button type="submit"><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleDateString('en-GB')} · {item.read_at ? 'Read' : 'New'}</small></button></form>
    </li>{/each}</ol>
  {/if}
</section>
<style>
 .notice-settings{padding:20px;margin:18px 0}.notice-settings h2{margin:0}.notice-actions{display:flex;flex-wrap:wrap;gap:10px}.notice-list{list-style:none;padding:0;display:grid;gap:9px}.notice-list li{background:#104a36;border:1px solid #4d785e;border-radius:14px}.notice-list li.unread{border-left:5px solid #ecc76d}.notice-list button{color:#fff;background:transparent;border:0;padding:16px;text-align:left;width:100%;cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center}.notice-list small{color:#c8ddc4}
</style>
