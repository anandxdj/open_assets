declare module "cdt2d" {
  export default function cdt2d(
    points: Array<[number, number]> | number[][],
    edges?: Array<[number, number]> | number[][],
    options?: { delaunay?: boolean; interior?: boolean; exterior?: boolean; infinity?: boolean },
  ): Array<[number, number, number]>;
}
