cmake_minimum_required(VERSION 3.15)
project(caption-stories-reader-docker NONE)

# Docker image name and tag
if(NOT DEFINED DOCKER_IMAGE)
  set(DOCKER_IMAGE "docker.io/amitkshirsagar13/caption-stories-reader")
endif()
if(NOT DEFINED DOCKER_TAG)
  set(DOCKER_TAG "latest")
endif()

set(IMAGE_FULL "${DOCKER_IMAGE}:${DOCKER_TAG}")

# Build Docker image target
add_custom_target(build-image
  COMMAND ${CMAKE_COMMAND} -E echo "Building Docker image ${IMAGE_FULL}"
  COMMAND ${CMAKE_COMMAND} -E env DOCKER_BUILDKIT=1 docker build -t ${IMAGE_FULL} .
  WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
  COMMENT "Docker: build ${IMAGE_FULL}"
)

# Optional push target
add_custom_target(push-image
  COMMAND ${CMAKE_COMMAND} -E echo "Pushing Docker image ${IMAGE_FULL}"
  COMMAND docker push ${IMAGE_FULL}
  DEPENDS build-image
  COMMENT "Docker: push ${IMAGE_FULL}"
)
