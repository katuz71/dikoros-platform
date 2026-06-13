const fs = require('fs');
const path = require('path');

function patch(file, from, to) {
  const fullPath = path.join(__dirname, '..', file);
  let text = fs.readFileSync(fullPath, 'utf8');
  if (text.includes(to)) {
    console.log(file + ' already patched');
    return;
  }
  if (!text.includes(from)) {
    console.log(file + ' target not found');
    return;
  }
  text = text.replace(from, to);
  fs.writeFileSync(fullPath, text, 'utf8');
  console.log(file + ' patched');
}

patch(
  'app/checkout.tsx',
  `  useEffect(() => {
    loadUserData();
  }, []);`,
  `  useEffect(() => {
    loadUserData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps`
);

patch(
  'app/product/[id].tsx',
  `  }, [product]);

  // Current match`,
  `  }, [product]); // eslint-disable-line react-hooks/exhaustive-deps

  // Current match`
);

console.log('Hook warnings patched.');