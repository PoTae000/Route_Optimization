<script>
	import './layout.css';
	import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';
	import { inject } from '@vercel/analytics';

	injectSpeedInsights();
	inject();

	let { children } = $props();
</script>

{@render children()}
