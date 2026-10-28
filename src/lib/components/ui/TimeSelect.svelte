<!-- TimeSelect.svelte — pemilih jam berbasis <select> (pengganti <input type="time"> yang glitch di dark mode Chromium). Nilai: 'HH:MM'. -->
<script lang="ts">
  import { timeSlots, toHHMM } from '$lib/shared/charterWorkHours';

  let {
    value = $bindable(''),
    step = 15,
    disabled = false,
    id = undefined,
    ariaLabel = 'Pilih jam',
    class: klass = ''
  } = $props<{ value?: string; step?: number; disabled?: boolean; id?: string; ariaLabel?: string; class?: string }>();

  const slots = $derived(timeSlots(step));
  const current = $derived(toHHMM(value));
  // Nilai lama di luar grid (mis. 08:10) tetap tampil agar tidak hilang diam-diam.
  const options = $derived(current && !slots.includes(current) ? [...slots, current].sort() : slots);
</script>

<select {id} {disabled} aria-label={ariaLabel} value={current} class={klass} style="color-scheme: light dark"
  onchange={(e) => (value = e.currentTarget.value)}>
  <option value="">--:--</option>
  {#each options as t}
    <option value={t}>{t}</option>
  {/each}
</select>
