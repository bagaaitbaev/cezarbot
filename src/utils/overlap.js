/**
 * [aStart, aEnd) және [bStart, bEnd) қиылыса ма (миллисекунд)
 */
export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
