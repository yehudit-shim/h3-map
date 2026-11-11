npm create vite@latest h3-map -- --template react
cd h3-map
npm install
npm install deck.gl @deck.gl/react @deck.gl/core @deck.gl/geo-layers @deck.gl/layers maplibre-gl react-map-gl h3-js

python -m venv .venv
source .venv\Scripts\activate
pip install h3 pydeck pandas geopandas
pip install fastapi uvicorn
