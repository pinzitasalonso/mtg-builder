/** The playtest tables' ground as one flat colour: the middle of the
    gradient `.pt-root` is painted with (#181327 to #0d0a16 in globals.css).

    While a table is open the page behind it takes this colour
    (useTableGround in components/deck/playtest-parts.tsx): an iPhone held
    sideways paints the strips beside the notch with the page's background.
    The table's own ground fades into the same colour at its left and right
    edges, so the two meet without a seam. */
export const TABLE_GROUND = "#120e1e";
