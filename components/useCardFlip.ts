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

export function useCardFlip(name: string, imageUri: string | null | undefined) {
  const back = backImageOf(name, imageUri);
  const [canFlip, setCanFlip] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [turning, setTurning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setCanFlip(false);
    setFlipped(false);
    if (!back) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && setCanFlip(true);
    img.src = back;
    return () => {
      live = false;
      img.onload = null;
    };
  }, [back]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function toggle() {
    if (!canFlip || turning) return;
    setTurning(true);
    timers.current.push(setTimeout(() => setFlipped((f) => !f), 140));
    timers.current.push(setTimeout(() => setTurning(false), 300));
  }

  return { canFlip, flipped, turning, toggle, src: flipped && back ? back : imageUri ?? undefined };
}
