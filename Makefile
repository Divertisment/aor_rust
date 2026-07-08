obj-m += aor_mem.o

all:
	make -C /lib/modules/$(shell uname -r)/build M=$(PWD) modules

clean:
	make -C /lib/modules/$(shell uname -r)/build M=$(PWD) clean

install:
	sudo insmod aor_mem.ko

remove:
	sudo rmmod aor_mem

test:
	@echo "Testing aor_mem..."
	@echo "Usage: echo 'PID ADDR LEN' | sudo tee /proc/aor_mem; sudo cat /proc/aor_mem"
