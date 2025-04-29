#!/bin/bash
# This script converts a sequence of numbered image files to various formats
# with support for dimensions, alpha transparency, and multiple encoding options
# ../imaginator.sh  -i animate-00%03d.png -o dance.gif --format gif  --optimize 3 --gif-dither sierra2_4a --format gif --gif-colors 0
# Default values
INPUT_PATTERN="img%04d.png"  # Default input pattern
OUTPUT_FILE="output.mp4"     # Default output filename
FPS=24                       # Default frames per second
START_NUMBER=1               # Default starting number for the sequence
CODEC="libx264"              # Default video codec
WIDTH=""                     # No default width (auto-detect)
HEIGHT=""                    # No default height (auto-detect)
FORMAT="mp4"                 # Default output format
QUALITY="lossless"           # Default quality (lossless or lossy)
CRF=0                        # Default CRF value (0 = lossless for x264)
PRESET="veryslow"            # Default encoding preset
PIX_FMT="yuva420p"           # Default pixel format (supporting alpha)
GIF_COLORS=256               # Default number of colors for GIF
TEMP_DIR=""                  # Temporary directory for processing
PALETTE_FILE=""              # Palette file for high-quality GIF conversion
VERBOSE=0                    # Verbose output flag
KEEP_TEMP=0                  # Keep temporary files flag
OPTIMIZE_LEVEL=0             # GIF optimization level (0-3)
ALPHA_METHOD="yuva420p"      # Default alpha method for videos
GIF_DITHER="sierra2_4a"      # Default dithering method for GIFs

# Display help information
show_help() {
    echo "Imaginator"
    echo "=================================="
    echo
    echo "Usage: $0 [options]"
    echo
    echo "Basic Options:"
    echo "  -i, --input PATTERN    Input file pattern (e.g., 'img%04d.png', 'frame_%d.jpg')"
    echo "  -o, --output FILE      Output filename (default: output.mp4)"
    echo "  -f, --fps NUMBER       Frames per second (default: 24)"
    echo "  -s, --start NUMBER     Starting frame number (default: 1)"
    echo "  -c, --codec CODEC      Video codec (default: libx264, options: libx264, libx265, prores, etc.)"
    echo "  -h, --help             Display this help message"
    echo
    echo "Format Options:"
    echo "  --format FORMAT        Output format (mp4, gif, webm, mov, etc.)"
    echo "  --quality MODE         Quality mode (lossless, lossy, or specific value 0-51 for CRF)"
    echo "  --preset PRESET        Encoding preset (ultrafast, superfast, fast, medium, slow, veryslow)"
    echo "  --crf VALUE            Constant Rate Factor value (0-51, lower = higher quality)"
    echo
    echo "Dimension Options:"
    echo "  -w, --width WIDTH      Set output width (in pixels)"
    echo "  -h, --height HEIGHT    Set output height (in pixels)"
    echo "  --scale SCALE          Scale factor (e.g., 0.5 for half size)"
    echo "  --fit MODE             Resize mode (contain, cover, stretch)"
    echo
    echo "Alpha/Transparency Options:"
    echo "  --alpha METHOD         Alpha handling method for videos (yuva420p, rgba, none)"
    echo "  --gif-transparency     Enable transparency in GIF output"
    echo "  --gif-colors NUMBER    Number of colors for GIF (2-256, default: 256)"
    echo "  --gif-dither METHOD    Dithering method for GIF (none, sierra2_4a, floyd_steinberg)"
    echo
    echo "Optimization Options:"
    echo "  --optimize LEVEL       GIF optimization level (0-3, higher = better compression)"
    echo "  --lossy-gif VALUE      Apply lossy compression to GIF (1-200, higher = more compression)"
    echo "  --keep-temp            Keep temporary files (for debugging)"
    echo "  --verbose              Show detailed processing information"
    echo
    echo "Examples:"
    echo "  # Convert PNG sequence to lossless MP4 with alpha transparency"
    echo "  $0 -i img%04d.png -o movie.mp4 -f 30 --alpha yuva420p --quality lossless"
    echo
    echo "  # Convert sequence to optimized GIF with transparency"
    echo "  $0 -i img%04d.png -o animation.gif --format gif --optimize 3 --gif-transparency"
    echo
    echo "  # Resize sequence while converting to WebM"
    echo "  $0 -i img%04d.png -o video.webm --format webm -w 1280 -h 720 --quality 20"
    echo
    exit 0
}

# Function to check dependencies
check_dependencies() {
    local missing_deps=()

    for cmd in ffmpeg gifsicle optipng; do
        if ! command -v $cmd &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done

    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo "Warning: The following dependencies are missing:"
        for dep in "${missing_deps[@]}"; do
            echo "  - $dep"
        done
        echo
        echo "Some features may not work properly."
        echo "To install missing dependencies:"
        echo "  - On Ubuntu/Debian: sudo apt-get install ffmpeg gifsicle optipng"
        echo "  - On macOS with Homebrew: brew install ffmpeg gifsicle optipng"
        echo
        read -p "Continue anyway? (y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Function to create a temporary directory
create_temp_dir() {
    TEMP_DIR=$(mktemp -d)
    if [ $VERBOSE -eq 1 ]; then
        echo "Created temporary directory: $TEMP_DIR"
    fi
    PALETTE_FILE="$TEMP_DIR/palette.png"
}

# Function to clean up temporary files
cleanup() {
    if [ -n "$TEMP_DIR" ] && [ $KEEP_TEMP -eq 0 ]; then
        if [ $VERBOSE -eq 1 ]; then
            echo "Cleaning up temporary directory: $TEMP_DIR"
        fi
        rm -rf "$TEMP_DIR"
    fi
}

# Function to check if input files exist
check_input_files() {
    # Extract the pattern without the format specifier
    local base_pattern=$(echo "$INPUT_PATTERN" | sed -E 's/%[0-9]*d/*/g')
    local dir_pattern=$(dirname "$base_pattern")

    # Handle case where pattern is in current directory
    if [ "$dir_pattern" == "." ]; then
        dir_pattern=""
    else
        dir_pattern="$dir_pattern/"
    fi

    # Try to find at least one matching file
    local found_files=$(find "${dir_pattern:-.}" -maxdepth 1 -type f -name "$(basename "$base_pattern")" | wc -l)

    if [ "$found_files" -eq 0 ]; then
        echo "Error: No input files found matching pattern: $INPUT_PATTERN"
        echo "Please check your input pattern and ensure files exist."
        exit 1
    fi

    if [ $VERBOSE -eq 1 ]; then
        echo "Found approximately $found_files input files."
    fi
}

# Function to get dimensions of first frame
get_input_dimensions() {
    # Find the first input file based on the pattern
    local pattern_base=$(echo "$INPUT_PATTERN" | sed -E 's/%[0-9]*d/*/g')
    local first_file=$(ls -1 $pattern_base 2>/dev/null | head -n 1)

    if [ -z "$first_file" ]; then
        echo "Warning: Could not find a file to determine dimensions."
        return
    fi

    if [ $VERBOSE -eq 1 ]; then
        echo "Getting dimensions from first frame: $first_file"
    fi

    # Use ffprobe to get dimensions
    local dimensions=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$first_file" 2>/dev/null)

    if [ -n "$dimensions" ]; then
        INPUT_WIDTH=$(echo $dimensions | cut -d'x' -f1)
        INPUT_HEIGHT=$(echo $dimensions | cut -d'x' -f2)

        if [ $VERBOSE -eq 1 ]; then
            echo "Detected input dimensions: ${INPUT_WIDTH}x${INPUT_HEIGHT}"
        fi
    fi
}

# Function to generate a high-quality palette for GIF conversion
generate_palette() {
    echo "Generating color palette for high-quality GIF conversion..."

    local filters="fps=$FPS"

    # Add scaling if dimensions are specified
    if [ -n "$WIDTH" ] || [ -n "$HEIGHT" ]; then
        local scale_arg="${WIDTH:-iw}:${HEIGHT:-ih}"
        filters="$filters,scale=$scale_arg:flags=lanczos"
    fi

    # Add transparency handling if requested
    if [ "$GIF_TRANSPARENCY" == "1" ]; then
        filters="$filters,palettegen=reserve_transparent=1:stats_mode=full"
    else
        filters="$filters,palettegen=stats_mode=full"
    fi

    # Generate the palette
    ffmpeg -v warning -start_number $START_NUMBER -i "$INPUT_PATTERN" -vf "$filters" -y "$PALETTE_FILE"

    if [ $? -ne 0 ]; then
        echo "Error: Failed to generate color palette"
        cleanup
        exit 1
    fi
}

# Function to create a GIF using the palette
create_gif_with_palette() {
    echo "Creating optimized GIF using palette method..."

    # Build the filtergraph with proper frame disposal
    local filtergraph="\
        [0:v]fps=$FPS,\
        scale=${WIDTH:-iw}:${HEIGHT:-ih}:flags=lanczos\
        [scaled];\
        [scaled][1:v]paletteuse=dither=$GIF_DITHER:new=1:alpha_threshold=128\
        "

    # Create the GIF with proper disposal method
    ffmpeg -v warning \
        -start_number $START_NUMBER \
        -i "$INPUT_PATTERN" \
        -i "$PALETTE_FILE" \
        -lavfi "$filtergraph" \
        -gifflags +transdiff \
        -y "$OUTPUT_FILE"

    if [ $? -ne 0 ]; then
        echo "Error: Failed to create GIF"
        cleanup
        exit 1
    fi
}

# Function to optimize GIF with gifsicle
optimize_gif() {
    if ! command -v gifsicle &> /dev/null; then
        echo "Warning: gifsicle not found, skipping GIF optimization"
        return
    fi

    echo "Optimizing GIF with gifsicle (level $OPTIMIZE_LEVEL)..."

    local optimization_args=""
    local lossy_args=""

    # Set optimization level
    case $OPTIMIZE_LEVEL in
        1) optimization_args="-O1" ;;
        2) optimization_args="-O2" ;;
        3) optimization_args="-O3" ;;
        *) optimization_args="" ;;
    esac

    # Add lossy compression if specified
    if [ -n "$LOSSY_GIF" ] && [ "$LOSSY_GIF" -gt 0 ]; then
        lossy_args="--lossy=$LOSSY_GIF"
    fi

    # Generate a temporary filename for the optimized GIF
    local temp_gif="$TEMP_DIR/optimized.gif"

    # Run gifsicle
    #gifsicle $optimization_args $lossy_args --colors $GIF_COLORS "$OUTPUT_FILE" -o "$temp_gif"

    if [ "$GIF_COLORS" -eq 0 ]; then
        colors_arg="--colors 0"
    else
        colors_arg="--colors $GIF_COLORS"
    fi
    gifsicle $optimization_args $lossy_args $colors_arg "$OUTPUT_FILE" -o "$temp_gif"
    if [ $? -eq 0 ]; then
        # Replace original with optimized version
        mv "$temp_gif" "$OUTPUT_FILE"

        # Show compression results
        if [ $VERBOSE -eq 1 ]; then
            original_size=$(stat -c%s "$OUTPUT_FILE" 2>/dev/null || stat -f%z "$OUTPUT_FILE")
            optimized_size=$(stat -c%s "$temp_gif" 2>/dev/null || stat -f%z "$temp_gif")
            echo "GIF optimization complete. Size reduction: $((original_size - optimized_size)) bytes"
        fi
    else
        echo "Warning: GIF optimization failed"
    fi
}

# Function to create a video with alpha transparency
create_video_with_alpha() {
    echo "Creating video with alpha transparency support..."

    local filters=""
    local pix_fmt_arg=""

    # Set pixel format based on alpha method
    case $ALPHA_METHOD in
        yuva420p) pix_fmt_arg="yuva420p" ;;
        rgba) pix_fmt_arg="rgba" ;;
        none) pix_fmt_arg="yuv420p" ;;
        *) pix_fmt_arg="yuva420p" ;;
    esac

    # Add scaling if dimensions are specified
    if [ -n "$WIDTH" ] || [ -n "$HEIGHT" ]; then
        local scale_arg="${WIDTH:-iw}:${HEIGHT:-ih}"
        filters="-vf scale=$scale_arg:flags=lanczos"
    fi

    # Set CRF value based on quality setting
    if [[ "$QUALITY" == "lossless" ]]; then
        CRF=0
    elif [[ "$QUALITY" == "lossy" ]]; then
        # Use a reasonable default for lossy compression
        if [ "$CODEC" == "libx264" ] || [ "$CODEC" == "libx265" ]; then
            CRF=23
        else
            CRF=18  # Default for other codecs
        fi
    fi

    # Create command for different formats
    local codec_args=""
    if [[ "$FORMAT" == "webm" ]]; then
        # For WebM with alpha support
        CODEC="libvpx-vp9"
        codec_args="-crf $CRF -b:v 0 -pix_fmt $pix_fmt_arg"
    elif [[ "$FORMAT" == "mov" || "$FORMAT" == "qt" ]]; then
        # For QuickTime/MOV with alpha
        codec_args="-c:v prores_ks -pix_fmt $pix_fmt_arg -profile:v 4444"
    else
        # Default for MP4/other formats
        codec_args="-c:v $CODEC -preset $PRESET -crf $CRF -pix_fmt $pix_fmt_arg"
    fi

    # Create the video
    ffmpeg -v warning -start_number $START_NUMBER -framerate $FPS -i "$INPUT_PATTERN" \
        $filters $codec_args "$OUTPUT_FILE"

    if [ $? -ne 0 ]; then
        echo "Error: Failed to create video"
        cleanup
        exit 1
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -i|--input)
            INPUT_PATTERN="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        -f|--fps)
            FPS="$2"
            shift 2
            ;;
        -s|--start)
            START_NUMBER="$2"
            shift 2
            ;;
        -c|--codec)
            CODEC="$2"
            shift 2
            ;;
        -w|--width)
            WIDTH="$2"
            shift 2
            ;;
        -h|--height)
            HEIGHT="$2"
            shift 2
            ;;
        --scale)
            SCALE="$2"
            shift 2
            ;;
        --format)
            FORMAT="${2,,}"  # Convert to lowercase
            shift 2
            ;;
        --quality)
            QUALITY="$2"
            # If quality is a number, assume it's a CRF value
            if [[ "$QUALITY" =~ ^[0-9]+$ ]]; then
                CRF="$QUALITY"
                QUALITY="custom"
            fi
            shift 2
            ;;
        --preset)
            PRESET="$2"
            shift 2
            ;;
        --crf)
            CRF="$2"
            shift 2
            ;;
        --alpha)
            ALPHA_METHOD="$2"
            shift 2
            ;;
        --gif-transparency)
            GIF_TRANSPARENCY=1
            shift
            ;;
        --gif-colors)
            GIF_COLORS="$2"
            shift 2
            ;;
        --gif-dither)
            GIF_DITHER="$2"
            shift 2
            ;;
        --optimize)
            OPTIMIZE_LEVEL="$2"
            shift 2
            ;;
        --lossy-gif)
            LOSSY_GIF="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=1
            shift
            ;;
        --keep-temp)
            KEEP_TEMP=1
            shift
            ;;
        --help)
            show_help
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information."
            exit 1
            ;;
    esac
done

# Set format based on output file extension if not explicitly specified
if [ -z "$FORMAT" ]; then
    FORMAT="${OUTPUT_FILE##*.}"
    FORMAT="${FORMAT,,}" # Convert to lowercase
fi

# Auto-enable GIF transparency for PNG inputs
if [[ "$FORMAT" == "gif" ]] && [[ "$INPUT_PATTERN" == *".png" ]] && [ -z "$GIF_TRANSPARENCY" ]; then
    GIF_TRANSPARENCY=1
    if [ $VERBOSE -eq 1 ]; then
        echo "Auto-enabled GIF transparency for PNG input."
    fi
fi

# Verify FFmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: FFmpeg is not installed or not in your PATH"
    echo "Please install FFmpeg and try again."
    exit 1
fi

# Run dependency checks
check_dependencies

# Create temp directory if needed
if [[ "$FORMAT" == "gif" ]]; then
    create_temp_dir
fi

# Trap to ensure cleanup
trap cleanup EXIT

# Check if input files exist
check_input_files

# Get input dimensions if needed
if [ -z "$WIDTH" ] || [ -z "$HEIGHT" ]; then
    get_input_dimensions
fi

# Print summary of conversion settings
echo "===== Enhanced Image Sequence Converter ====="
echo "Input pattern:    $INPUT_PATTERN"
echo "Output file:      $OUTPUT_FILE (${FORMAT^^} format)"
echo "Frame rate:       $FPS fps"
echo "Starting frame:   $START_NUMBER"

# Print dimension info
if [ -n "$WIDTH" ] || [ -n "$HEIGHT" ]; then
    echo "Output dimensions: ${WIDTH:-auto}x${HEIGHT:-auto}"
else
    echo "Output dimensions: original (${INPUT_WIDTH:-unknown}x${INPUT_HEIGHT:-unknown})"
fi

# Format-specific settings
if [[ "$FORMAT" == "gif" ]]; then
    echo "GIF settings:     Colors: $GIF_COLORS, Dither: $GIF_DITHER"
    echo "                  Transparency: ${GIF_TRANSPARENCY:-0}, Optimize: $OPTIMIZE_LEVEL"
    if [ -n "$LOSSY_GIF" ] && [ "$LOSSY_GIF" -gt 0 ]; then
        echo "                  Lossy compression: $LOSSY_GIF"
    fi
else
    echo "Video settings:   Codec: $CODEC, Quality: $QUALITY (CRF: $CRF)"
    echo "                  Alpha method: $ALPHA_METHOD, Preset: $PRESET"
fi

echo "========================================"

# Perform the conversion based on format
if [[ "$FORMAT" == "gif" ]]; then
    generate_palette
    create_gif_with_palette

    if [ $OPTIMIZE_LEVEL -gt 0 ]; then
        optimize_gif
    fi

    echo "GIF creation complete! Saved as: $OUTPUT_FILE"
else
    # For video formats
    create_video_with_alpha
    echo "Video creation complete! Saved as: $OUTPUT_FILE"
fi

# Final output size
if [ $VERBOSE -eq 1 ]; then
    final_size=$(stat -c%s "$OUTPUT_FILE" 2>/dev/null || stat -f%z "$OUTPUT_FILE")
    echo "Final file size: $(($final_size / 1024)) KB"
fi

exit 0
