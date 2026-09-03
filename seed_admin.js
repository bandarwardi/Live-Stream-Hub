const http = require('http');

const data = JSON.stringify({
  name: "Admin",
  username: "admin",
  email: "admin@example.com",
  password: "password123",
  role: "SUPER_ADMIN"
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/admin/admins',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  let resData = '';
  res.on('data', chunk => resData += chunk);
  res.on('end', () => console.log(resData));
});

req.on('error', error => {
  console.error(error);
});

req.write(data);
req.end();
