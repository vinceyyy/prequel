default:
	# Use static builds to make sure we don't have library version issues between the build env and lambda
	GOOS=linux GOARCH=amd64 go build -tags "osusergo netgo static_build lambda.norpc" -ldflags '-extldflags "-static"' -o bootstrap
	zip soci_index_generator_lambda.zip bootstrap

# Run all unit tests except integration tests
test:
	go test -v ./... -skip TestHandler

# Run only integration tests that require environment variables
test-integration:
	go test -v -run "^TestHandler" .

# Run all tests including integration tests
test-all: test test-integration
