<script lang="ts">
	let {
		kicker,
		title,
		intro,
		phase,
		detail
	}: {
		kicker: string;
		title: string;
		intro: string;
		phase: string;
		detail: string;
	} = $props();
</script>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/"><span aria-hidden="true">←</span> Home</a>
		<p class="flow-kicker">{kicker}</p>
		<h1>{title}</h1>
		<p class="flow-intro">{intro}</p>
		<span class="phase-pill">{phase}</span>
	</div>
	<div class="placeholder-card">
		<strong>On the way.</strong>
		{detail}
	</div>
</section>
