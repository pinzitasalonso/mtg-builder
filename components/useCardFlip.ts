"use client";

import { useEffect, useRef, useState } from "react";

/* Turning a double-faced card over.

   A card is stored with its front image only. Scryfall keeps the back of a
   double-faced card at the same address with /back/ for /front/, so a card
   whose name has two faces ("Delver of Secrets // Insectile Aberration")
   checks that the back image exists — split and adventure cards share the
   "A // B" name but have no back — and only then offers to flip. The swap
   happens halfway through a quick turn (see .card-flip in globals.css). */
export function backImageOf(name: string, imageUri: string | null | undefined): string | null {
  if (!imageUri || !name.includes(" // ") || !imageUri.includes("/front/")) return null;
  return imageUri.replace("/front/", "/back/");
}

// What we found out about each back image, so a card that remounts (a
// playtest card moving between zones) doesn't ask again.
const backKnown = new Map<string, boolean>();

/** True once this card's back image is known to exist. */
export function hasKnownBack(name: string, imageUri: string | null | undefined): boolean {
  const back = backImageOf(name, imageUri);
  return !!back && backKnown.get(back) === true;
}

/** The back image of a double-faced card, once it is known to exist; null
    for a single-faced card, and while the check is under way. */
export function useVerifiedBack(name: string, imageUri: string | null | undefined): string | null {
  const back = backImageOf(name, imageUri);
  const [ok, setOk] = useState(() => !!back && backKnown.get(back) === true);

  useEffect(() => {
    if (!back) {
      setOk(false);
      return;
    }
    const known = backKnown.get(back);
    if (known !== undefined) {
      setOk(known);
      return;
    }
    setOk(false);
    let live = true;
    const img = new Image();
    // Cached even if this card is gone by then: the next one asks no more.
    img.onload = () => {
      backKnown.set(back, true);
      if (live) setOk(true);
    };
    img.onerror = () => backKnown.set(back, false);
    img.src = back;
    return () => {
      live = false;
    };
  }, [back]);

  return ok ? back : null;
}

export function useCardFlip(name: string, imageUri: string | null | undefined) {
  const back = useVerifiedBack(name, imageUri);
  const canFlip = back !== null;
  const [flipped, setFlipped] = useState(false);
  const [turning, setTurning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Another card in the same place starts on its front.
  const face = backImageOf(name, imageUri);
  useEffect(() => {
    setFlipped(false);
  }, [face]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function toggle() {
    if (!canFlip || turning) return;
    setTurning(true);
    timers.current.push(setTimeout(() => setFlipped((f) => !f), 140));
    timers.current.push(setTimeout(() => setTurning(false), 300));
  }

  return { canFlip, flipped, turning, toggle, src: flipped && back ? back : imageUri ?? undefined };
}
