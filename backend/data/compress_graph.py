#!/usr/bin/env python3
"""
Compress neutreeko_graph.json to a lightweight format.

Changes:
- Board: 2D array -> flat string (e.g., ".W.W...B.....W..B.B.")
- Position: high precision floats -> integers, as array [x, y]
- Remove nodes array (reconstruct from nodesMap)
- Remove edges array (reconstruct from children)
- Remove default values (hidden: false, hiddenChildren: false)
- Shorten keys: board->b, currentPlayer->p, children->c, position->pos, color->col, parentId->par
"""

import json
import sys

def flatten_board(board):
    """Convert 2D board array to flat string."""
    return ''.join(''.join(row) for row in board)

def unflatten_board(flat, size=5):
    """Convert flat string back to 2D array."""
    return [[flat[i*size + j] for j in range(size)] for i in range(size)]

def compress_node(node):
    """Compress a single node to minimal format."""
    compressed = {
        'b': flatten_board(node['board']),
        'p': node['currentPlayer'],
    }

    # Only include non-empty children
    if node.get('children'):
        compressed['c'] = node['children']

    # Position as integers in array format
    if 'position' in node:
        compressed['pos'] = [
            round(node['position']['x']),
            round(node['position']['y'])
        ]

    # Only include color if not default white
    color = node.get('color', '#ffffff')
    if color and color != '#ffffff':
        compressed['col'] = color

    # Only include parentId if exists
    if node.get('parentId'):
        compressed['par'] = node['parentId']

    # Skip hidden and hiddenChildren as they default to false

    return compressed

def compress_graph(input_file, output_file):
    print(f"Loading {input_file}...")
    with open(input_file, 'r') as f:
        data = json.load(f)

    print(f"Original nodes: {len(data.get('nodes', []))}")
    print(f"Original nodesMap: {len(data.get('nodesMap', {}))}")
    print(f"Original edges: {len(data.get('edges', []))}")

    # Compress nodesMap
    print("Compressing nodesMap...")
    compressed_map = {}
    for node_id, node in data['nodesMap'].items():
        compressed_map[node_id] = compress_node(node)

    # Create compressed structure
    compressed = {
        'nodesMap': compressed_map,
        'selectedNodeId': data.get('selectedNodeId'),
        '_version': 2  # Mark as compressed format
    }

    # Save without indentation
    print(f"Saving to {output_file}...")
    with open(output_file, 'w') as f:
        json.dump(compressed, f, separators=(',', ':'), ensure_ascii=False)

    # Report size
    import os
    original_size = os.path.getsize(input_file)
    new_size = os.path.getsize(output_file)
    print(f"\nOriginal size: {original_size:,} bytes ({original_size/1024/1024:.1f} MB)")
    print(f"Compressed size: {new_size:,} bytes ({new_size/1024/1024:.1f} MB)")
    print(f"Reduction: {(1 - new_size/original_size)*100:.1f}%")

if __name__ == '__main__':
    input_file = 'neutreeko_graph.json'
    output_file = 'neutreeko_graph_compressed.json'

    if len(sys.argv) > 1:
        input_file = sys.argv[1]
    if len(sys.argv) > 2:
        output_file = sys.argv[2]

    compress_graph(input_file, output_file)
