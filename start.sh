#!/bin/bash

# Caption Extractor Startup Script
# This script initializes and runs the caption extractor Python program

set -e  # Exit on any error

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source .venv/bin/activate 2>/dev/null || true  # Activate virtual environment if it exists

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if UV is installed
check_uv() {
    if ! command -v uv &> /dev/null; then
        print_error "UV package manager not found. Please install UV first."
        print_status "Visit: https://docs.astral.sh/uv/getting-started/installation/"
        exit 1
    fi
    print_success "UV package manager found"
}

# Function to setup virtual environment
setup_environment() {
    print_status "Setting up virtual environment and dependencies..."
    
    # Create virtual environment if it doesn't exist
    if [ ! -d ".venv" ]; then
        print_status "Creating virtual environment..."
        python3.12 -m venv .venv
    fi
    
    # Activate the environment briefly to ensure tools are in place
    source .venv/bin/activate
    
    print_status "Installing build requirements and dependencies..."
    
    print_status "Using Python version: $(python --version)"
    # 1. Force install hatchling first
    uv pip install hatchling editables

    print_status "Installing project dependencies..."
    
    # 2. Install your project using --no-build-isolation
    uv pip install --no-build-isolation --index-url https://pypi.org/simple --extra-index-url https://www.paddlepaddle.org.cn/packages/stable/cu126/ --index-strategy unsafe-best-match -e .

    print_success "Environment setup completed"
}

# Function to create required directories
create_directories() {
    print_status "Creating required directories..."
    
    mkdir -p logs
    mkdir -p models
    mkdir -p docs
    mkdir -p tests
    touch logs/caption-stories-reader.log
    
    # Create data directory if it doesn't exist
    if [ ! -d "data" ]; then
        mkdir -p data
        print_warning "Created empty data directory. Please add image files to process."
    fi
    
    print_success "Directories created"
}

# Function to check if data directory has images
check_data() {
    if [ ! "$(ls -A data/ 2>/dev/null)" ]; then
        print_warning "No files found in data directory."
        print_status "Please add image files (.jpg, .jpeg, .png, .bmp, .tiff, .webp) to the data folder"
        return 1
    fi
    
    # Count supported image files
    image_count=$(find data -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.bmp" -o -iname "*.tiff" -o -iname "*.webp" \) | wc -l)
    
    if [ "$image_count" -eq 0 ]; then
        print_warning "No supported image files found in data directory."
        print_status "Supported formats: .jpg, .jpeg, .png, .bmp, .tiff, .webp"
        return 1
    fi
    
    print_success "Found $image_count image files to process"
    return 0
}

# Function to display help
show_help() {
    cat << EOF
Caption Extractor - OCR text extraction using PaddleOCR

Usage: $0 [options]

Options:
    --help, -h          Show this help message
    --mode MODE         Mode to run: 'api' or 'batch' (default: api)
    --setup             Setup environment only (don't run processing)
    --verbose, -v       Enable verbose logging
    --config FILE       Use custom config file (default: config.yml)
    --input-folder DIR  Override input folder from config (batch mode only)
    --threads N         Override number of threads from config (batch mode only)
    --check             Check environment and data without processing
    
Examples:
    $0                      # Run in web API mode (default)
    $0 --mode api           # Run in web API mode
    $0 --mode batch         # Run in batch processing mode
    $0 --mode batch --verbose  # Run batch mode with verbose logging
    $0 --mode batch --threads 8  # Run batch mode with 8 threads
    $0 --setup              # Setup environment only
    $0 --check              # Check environment and data

Modes:
    api     - Start FastAPI web server (default)
    batch   - Process images in batch mode from data folder

Configuration:
    Edit config.yml to customize processing settings, model parameters,
    and other options before running.

EOF
}

# Parse command line arguments
SETUP_ONLY=false
CHECK_ONLY=false
MODE="api"  # Default mode is web API
VERBOSE=""
CONFIG_FILE=""
INPUT_FOLDER=""
THREADS=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            show_help
            exit 0
            ;;
        --mode)
            MODE="$2"
            if [ "$MODE" != "api" ] && [ "$MODE" != "batch" ]; then
                print_error "Invalid mode: $MODE. Use 'api' or 'batch'"
                exit 1
            fi
            shift 2
            ;;
        --setup)
            SETUP_ONLY=true
            shift
            ;;
        --check)
            CHECK_ONLY=true
            shift
            ;;
        --verbose|-v)
            VERBOSE="--verbose"
            shift
            ;;
        --config)
            CONFIG_FILE="--config $2"
            shift 2
            ;;
        --input-folder)
            INPUT_FOLDER="--input-folder $2"
            shift 2
            ;;
        --threads)
            THREADS="--threads $2"
            shift 2
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Main execution
main() {
    print_status "Starting Caption Extractor initialization..."
    
    # Check prerequisites
    check_uv
    
    # Create directories
    create_directories
    
    # Setup environment
    setup_environment
    
    if [ "$SETUP_ONLY" = true ]; then
        print_success "Environment setup completed. Use '$0' to run processing."
        exit 0
    fi
    
    # Check configuration file
    config_file="${CONFIG_FILE#--config }"
    if [ -z "$config_file" ]; then
        if [ -f "config/config.yml" ]; then
            config_file="config/config.yml"
        else
            config_file="config.yml"
        fi
    fi
    
    if [ ! -f "$config_file" ]; then
        print_error "Configuration file not found: $config_file"
        exit 1
    fi
    print_success "Configuration file found: $config_file"
    
    # Check data (only required for batch mode)
    if [ "$MODE" = "batch" ]; then
        if ! check_data && [ "$CHECK_ONLY" != true ]; then
            print_error "No image files to process. Add images to data folder and try again."
            exit 1
        fi
    fi
    
    if [ "$CHECK_ONLY" = true ]; then
        print_success "Environment and data check completed successfully"
        exit 0
    fi
    
    # Run in the selected mode
    print_status "Starting in $MODE mode..."
    echo ""
    
    # Activate virtual environment and run the program
    if [ -f ".venv/Scripts/activate" ]; then
        source .venv/Scripts/activate
    else
        source .venv/bin/activate
    fi

    # Prepare python module arguments
    CMD_ARGS=("--mode" "$MODE")
    if [ -n "$CONFIG_FILE" ]; then
        CMD_ARGS+=($CONFIG_FILE)
    fi
    if [ -n "$INPUT_FOLDER" ]; then
        CMD_ARGS+=($INPUT_FOLDER)
    fi
    if [ -n "$THREADS" ]; then
        CMD_ARGS+=($THREADS)
    fi

    if [ "$MODE" = "api" ]; then
        print_status "Starting Caption Stories Reader Web UI..."
    else
        print_status "Starting batch image processing..."
    fi

    python -m src.main "${CMD_ARGS[@]}"
    
    exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        print_success "Execution completed successfully!"
    else
        print_error "Execution failed with exit code $exit_code"
    fi
    
    exit $exit_code
}

# Run main function
main "$@"