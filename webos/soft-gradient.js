// Soft gradients in the manner of macOS wallpapers: a few large blurred
// patches of colour that melt into each other and drift very slowly over a
// dark ground. No edges anywhere. With the music they breathe: the bass
// swells them a little and lifts their light, louder passages move them a
// little faster, never in a hurry.
const VS = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
const FS = [
  "precision mediump float;",
  "uniform vec2 res;uniform float t,beat,glow;uniform vec3 base,c0,c1,c2,c3,c4;",
  "float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}",
  "vec3 acc;float wsum;",
  "void blob(vec3 c,float k,vec2 p){",
  "  vec2 o=vec2(0.62*sin(t*(0.11+0.03*k)+k*1.7),0.36*cos(t*(0.08+0.025*k)+k*2.9))+vec2(0.,0.5);",
  "  float r=(0.42+0.08*sin(t*0.13+k))*(1.+0.10*beat);",
  "  vec2 d=p-o;float w=exp(-dot(d,d)/(r*r));acc+=c*w;wsum+=w;",
  "}",
  "void main(){",
  "  vec2 uv=gl_FragCoord.xy/res;vec2 p=vec2((uv.x-0.5)*res.x/res.y,uv.y);",
  "  acc=vec3(0.);wsum=0.;",
  "  blob(c0,0.,p);blob(c1,1.,p);blob(c2,2.,p);blob(c3,3.,p);blob(c4,4.,p);",
  "  vec3 col=mix(base,acc/(wsum+1e-4),clamp(wsum*1.1,0.,1.));",
  // Where colours meet the mix greys a little: the saturation is lifted back.
  "  float l=dot(col,vec3(0.299,0.587,0.114));col=max(mix(vec3(l),col,1.35),0.)*glow;",
  // A grain finer than a step of colour: no bands in the gradients.
  "  col+=(hash(gl_FragCoord.xy+fract(t))-0.5)/128.;",
  "  gl_FragColor=vec4(col,1.);",
  "}"
].join("\n");

export function createSoftGradient(canvas) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) return null;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(prog));
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const u = {};
  ["res", "t", "beat", "glow", "base", "c0", "c1", "c2", "c3", "c4"].forEach((n) => u[n] = gl.getUniformLocation(prog, n));
  let clock = Math.random() * 100, lift = 0;
  return {
    render(dt, energy, beat, palette) {
      clock += dt * (0.25 + 0.7 * energy);
      lift += (energy - lift) * Math.min(1, dt * 0.8);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const loc = gl.getAttribLocation(prog, "a");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.t, clock);
      gl.uniform1f(u.beat, beat);
      gl.uniform1f(u.glow, 0.9 + 0.25 * lift + 0.12 * beat);
      gl.uniform3fv(u.base, palette.base);
      for (let i = 0; i < 5; i++) gl.uniform3fv(u["c" + i], palette.colors[i]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  };
}
