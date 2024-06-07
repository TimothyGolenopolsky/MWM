# 3D Star Visualization

This project is a 3D visualization of stars using Three.js, allowing for dynamic loading, searching, and customization of star data.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Project Structure](#project-structure)
- [Dependencies](#dependencies)

## Features

- **Dynamic Loading:** Load star data dynamically based on the view.
- **Customization:** Toggle star colors, sizes, and axes; adjust distance scaling and luminosity.
- **Efficient Spatial Partitioning:** Uses an octree for efficient spatial partitioning.

## Installation

To get started, clone the repository and install the dependencies:

```bash
git clone https://github.com/TimothyGolenopolsky/MWM.git
cd MWM
npm install
```
## Project Structure
```
MWM/
├── public/
│   ├── index.html
│   ├── main.js
│   ├── style.css
│   ├── bundle.js
│   └── .tsv
├── package.json
├── server.cjs
├── webpack.config.js
├── README.md
└── .gitignore
```
## Dependencies
* express: Fast, unopinionated, minimalist web framework for Node.js
* three: JavaScript 3D library
* d3: Data-Driven Documents
* gsap: GreenSock Animation Platform
* h3-js: JavaScript bindings for H3, a hexagonal hierarchical geospatial indexing system
* papaparse: Fast and powerful CSV (delimited text) parser that gracefully handles large files and malformed input
* webpack: A static module bundler for modern JavaScript applications
* webpack-cli: CLI for webpack & friends
* babel-loader: This package allows transpiling JavaScript files using Babel and webpack
* @babel/core: Babel compiler core.
* @babel/preset-env: A Babel preset for each environment.# MWM
