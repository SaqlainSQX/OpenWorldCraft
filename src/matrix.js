export default class Matrix
{
	constructor()
	{
		this.data = [
			1,0,0,0,
			0,1,0,0,
			0,0,1,0,
			0,0,0,1,
		];
	}
	
	set(
		m00 = 1, m01 = 0, m02 = 0, m03 = 0,
		m10 = 0, m11 = 1, m12 = 0, m13 = 0,
		m20 = 0, m21 = 0, m22 = 1, m23 = 0,
		m30 = 0, m31 = 0, m32 = 0, m33 = 1,
	) {
		let m = this.data;
		
		m[0]  = m00;
		m[1]  = m01;
		m[2]  = m02;
		m[3]  = m03;
		m[4]  = m10;
		m[5]  = m11;
		m[6]  = m12;
		m[7]  = m13;
		m[8]  = m20;
		m[9]  = m21;
		m[10] = m22;
		m[11] = m23;
		m[12] = m30;
		m[13] = m31;
		m[14] = m32;
		m[15] = m33;
	}
	
	perspective(fovy, aspect, near, far)
	{
		let fy = 1 / Math.tan(fovy / 2);
		let fx = fy / aspect;
		let nf = 1 / (near - far);
		let a  = (near + far) * nf;
		let b  = 2 * near * far * nf;
		
		this.set(
			fx, 0, 0, 0,
			 0,fy, 0, 0,
			 0, 0, a,-1,
			 0, 0, b, 0,
		);
	}
	
	translate(x, y, z)
	{
		let m = this.data;
		
		m[12] += x * m[0] + y * m[4] + z * m[8];
		m[13] += x * m[1] + y * m[5] + z * m[9];
		m[14] += x * m[2] + y * m[6] + z * m[10];
		m[15] += x * m[3] + y * m[7] + z * m[11];
	}
	
	rotateX(a)
	{
		let m = this.data;
		let s = Math.sin(a);
		let c = Math.cos(a);
		let a10 = m[4], a11 = m[5], a12 = m[6],  a13 = m[7];
		let a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
		
		m[4]  =  c * a10 + s * a20;
		m[5]  =  c * a11 + s * a21;
		m[6]  =  c * a12 + s * a22;
		m[7]  =  c * a13 + s * a23;
		m[8]  = -s * a10 + c * a20;
		m[9]  = -s * a11 + c * a21;
		m[10] = -s * a12 + c * a22;
		m[11] = -s * a13 + c * a23;
	}
	
	rotateY(a)
	{
		let m = this.data;
		let s = Math.sin(a);
		let c = Math.cos(a);
		let a00 = m[0], a01 = m[1], a02 = m[2],  a03 = m[3];
		let a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
		
		m[0]  =  c * a00 + s * a20;
		m[1]  =  c * a01 + s * a21;
		m[2]  =  c * a02 + s * a22;
		m[3]  =  c * a03 + s * a23;
		m[8]  = -s * a00 + c * a20;
		m[9]  = -s * a01 + c * a21;
		m[10] = -s * a02 + c * a22;
		m[11] = -s * a03 + c * a23;
	}
	
	rotateZ(a)
	{
		let m = this.data;
		let s = Math.sin(a);
		let c = Math.cos(a);
		let a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
		let a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];

		m[0] =  c * a00 + s * a10;
		m[1] =  c * a01 + s * a11;
		m[2] =  c * a02 + s * a12;
		m[3] =  c * a03 + s * a13;
		m[4] = -s * a00 + c * a10;
		m[5] = -s * a01 + c * a11;
		m[6] = -s * a02 + c * a12;
		m[7] = -s * a03 + c * a13;
	}

	// Orthographic projection. Column-major storage to match WebGL.
	ortho(l, r, b, t, n, f)
	{
		this.set(
			2 / (r - l), 0, 0, 0,
			0, 2 / (t - b), 0, 0,
			0, 0, -2 / (f - n), 0,
			-(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
		);
	}

	// World -> view matrix for a camera at `eye` looking at `target`, with a
	// reference up vector `up`. Standard OpenGL-style view (view space Z is
	// -forward).
	lookAt(ex, ey, ez, tx, ty, tz, ux, uy, uz)
	{
		// forward = normalize(target - eye)
		let fx = tx - ex, fy = ty - ey, fz = tz - ez;
		let fl = Math.sqrt(fx*fx + fy*fy + fz*fz) || 1;
		fx /= fl; fy /= fl; fz /= fl;

		// right = normalize(forward x up)
		let rx = fy*uz - fz*uy;
		let ry = fz*ux - fx*uz;
		let rz = fx*uy - fy*ux;
		let rl = Math.sqrt(rx*rx + ry*ry + rz*rz) || 1;
		rx /= rl; ry /= rl; rz /= rl;

		// up' = right x forward (re-orthogonalised)
		let u2x = ry*fz - rz*fy;
		let u2y = rz*fx - rx*fz;
		let u2z = rx*fy - ry*fx;

		// Column-major: each group of four is one column.
		this.set(
			rx,  u2x, -fx, 0,
			ry,  u2y, -fy, 0,
			rz,  u2z, -fz, 0,
			-(rx*ex + ry*ey + rz*ez),
			-(u2x*ex + u2y*ey + u2z*ez),
			fx*ex + fy*ey + fz*ez,
			1,
		);
	}

	// this = a * b (column-major)
	multiply(a, b)
	{
		let A = a.data, B = b.data;
		let r = new Array(16);
		for(let c = 0; c < 4; c++) {
			for(let rowi = 0; rowi < 4; rowi++) {
				let s = 0;
				for(let k = 0; k < 4; k++) {
					s += A[k * 4 + rowi] * B[c * 4 + k];
				}
				r[c * 4 + rowi] = s;
			}
		}
		for(let i = 0; i < 16; i++) this.data[i] = r[i];
	}
}
